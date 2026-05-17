import { writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { dump as yamlDump } from "js-yaml";
import type { Logger } from "pino";
import type { Db } from "../db/client.js";
import { cameras as camerasTable } from "../db/schema.js";
import { Supervisor } from "../platform/supervisor.js";
import { resolveGo2rtc } from "../platform/vendor.js";
import { dataPaths } from "../platform/paths.js";

export interface Go2rtcPorts {
  apiHost: string;
  apiPort: number;
  rtspHost: string;
  rtspPort: number;
  webrtcPort: number;
}

const DEFAULT_PORTS: Go2rtcPorts = {
  apiHost: "127.0.0.1",
  apiPort: 1984,
  rtspHost: "127.0.0.1",
  rtspPort: 8554,
  webrtcPort: 8555,
};

interface CameraStreamConfig {
  id: string;
  rtspUrl: string;
  subRtspUrl: string | null;
  enabled: boolean;
}

/** Compose the stream name used inside go2rtc for a camera. */
export function streamName(cameraId: string): string {
  return `cam-${cameraId}`;
}
export function subStreamName(cameraId: string): string {
  return `cam-${cameraId}-sub`;
}

/**
 * Render the YAML go2rtc reads on startup. Source of truth is the DB;
 * we only re-render this file (and restart go2rtc) when cameras change.
 */
export function renderConfig(
  cams: CameraStreamConfig[],
  ports: Go2rtcPorts,
): string {
  const streams: Record<string, string> = {};
  for (const c of cams) {
    if (!c.enabled) continue;
    streams[streamName(c.id)] = c.rtspUrl;
    if (c.subRtspUrl) {
      streams[subStreamName(c.id)] = c.subRtspUrl;
    }
  }

  const config = {
    api: { listen: `${ports.apiHost}:${ports.apiPort}` },
    rtsp: { listen: `${ports.rtspHost}:${ports.rtspPort}` },
    webrtc: { listen: `:${ports.webrtcPort}` },
    log: { level: "info", format: "text" },
    streams,
  };

  return yamlDump(config, { lineWidth: 200, noRefs: true });
}

export class Go2rtcService {
  private supervisor: Supervisor | null = null;
  private configPath: string;
  private lastConfigHash: string | null = null;

  constructor(
    private readonly db: Db,
    private readonly logger: Logger,
    private readonly ports: Go2rtcPorts = DEFAULT_PORTS,
  ) {
    this.configPath = join(dataPaths().root, "go2rtc.yaml");
  }

  getPorts(): Go2rtcPorts {
    return this.ports;
  }

  /** Read current cameras, render YAML, write file. Returns true if file changed. */
  private writeConfigFromDb(): boolean {
    const rows = this.db
      .select({
        id: camerasTable.id,
        rtspUrl: camerasTable.rtspUrl,
        subRtspUrl: camerasTable.subRtspUrl,
        enabled: camerasTable.enabled,
      })
      .from(camerasTable)
      .all();
    const yaml = renderConfig(rows, this.ports);
    const hash = createHash("sha256").update(yaml).digest("hex");
    if (hash === this.lastConfigHash && existsSync(this.configPath)) {
      return false;
    }
    writeFileSync(this.configPath, yaml, "utf8");
    this.lastConfigHash = hash;
    this.logger.info(
      { path: this.configPath, cameras: rows.length },
      "wrote go2rtc config",
    );
    return true;
  }

  async start(): Promise<void> {
    this.writeConfigFromDb();
    const binary = resolveGo2rtc();
    this.supervisor = new Supervisor({
      name: "go2rtc",
      command: binary,
      args: ["-config", this.configPath],
      logger: this.logger,
      restartDelayMs: 1000,
      maxRestartDelayMs: 30_000,
      shutdownGraceMs: 5000,
    });
    await this.supervisor.start();
  }

  async stop(): Promise<void> {
    if (this.supervisor) {
      await this.supervisor.stop();
      this.supervisor = null;
    }
  }

  /**
   * Called when a camera is added/updated/removed. Re-renders config and,
   * if it changed, restarts go2rtc. For Phase 1 simplicity we restart;
   * later we can use go2rtc's HTTP API to add/remove streams hot.
   */
  async reload(): Promise<void> {
    if (!this.supervisor) return;
    const changed = this.writeConfigFromDb();
    if (changed) {
      this.logger.info("reloading go2rtc (config changed)");
      await this.supervisor.restart();
    }
  }

  isRunning(): boolean {
    return this.supervisor?.isRunning() ?? false;
  }

  /** Best-effort liveness probe against go2rtc's HTTP API. */
  async health(): Promise<boolean> {
    if (!this.isRunning()) return false;
    try {
      const res = await fetch(
        `http://${this.ports.apiHost}:${this.ports.apiPort}/api`,
        { signal: AbortSignal.timeout(2000) },
      );
      return res.ok;
    } catch {
      return false;
    }
  }

  async getStreamInfo(cameraId: string): Promise<unknown | null> {
    if (!this.isRunning()) return null;
    try {
      const name = streamName(cameraId);
      const res = await fetch(
        `http://${this.ports.apiHost}:${this.ports.apiPort}/api/streams?src=${encodeURIComponent(name)}`,
        { signal: AbortSignal.timeout(3000) },
      );
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }
}

