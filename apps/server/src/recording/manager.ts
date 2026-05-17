import type { Logger } from "pino";
import { eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { cameras } from "../db/schema.js";
import { vendorStatus } from "../platform/vendor.js";
import type { Go2rtcService } from "../streaming/go2rtc.js";
import { CameraRecorder } from "./recorder.js";
import { ThumbnailGenerator } from "./thumbnails.js";

/**
 * Top-level orchestrator. Owns one CameraRecorder per enabled camera and
 * reacts to camera CRUD events via sync().
 */
export class RecordingManager {
  private readonly recorders = new Map<string, CameraRecorder>();
  private readonly thumbs: ThumbnailGenerator;
  private started = false;

  constructor(
    private readonly db: Db,
    private readonly logger: Logger,
    private readonly go2rtc: Go2rtcService,
  ) {
    this.thumbs = new ThumbnailGenerator(logger.child({ mod: "thumbs" }));
  }

  async start(): Promise<void> {
    if (this.started) return;
    if (!vendorStatus().ffmpeg) {
      this.logger.warn(
        "ffmpeg binary not found in vendor/; recording disabled. Run `pnpm fetch-vendor`.",
      );
      return;
    }
    this.started = true;
    await this.sync();
  }

  async stop(): Promise<void> {
    this.started = false;
    await Promise.all(
      [...this.recorders.values()].map((r) =>
        r.stop().catch((err) => this.logger.warn({ err }, "recorder stop")),
      ),
    );
    this.recorders.clear();
  }

  /** Diff current recorders against DB cameras; start/stop as needed. */
  async sync(): Promise<void> {
    if (!this.started) return;
    if (!this.go2rtc.isRunning()) {
      // Recordings pull from go2rtc's local RTSP server; without it, nothing to do.
      return;
    }
    const rows = this.db.select().from(cameras).all();
    const enabledIds = new Set(rows.filter((c) => c.enabled).map((c) => c.id));

    // Stop recorders for cameras that vanished or got disabled
    for (const [id, rec] of this.recorders) {
      if (!enabledIds.has(id)) {
        this.logger.info({ cameraId: id }, "stopping recorder (camera removed/disabled)");
        await rec.stop().catch((err) =>
          this.logger.warn({ err, cameraId: id }, "recorder stop failed"),
        );
        this.recorders.delete(id);
      }
    }

    const ports = this.go2rtc.getPorts();
    const rtspBase = `rtsp://${ports.rtspHost}:${ports.rtspPort}`;

    for (const cam of rows) {
      if (!cam.enabled) continue;
      if (this.recorders.has(cam.id)) continue;
      this.logger.info({ cameraId: cam.id, name: cam.name }, "starting recorder");
      const recorder = new CameraRecorder({
        cameraId: cam.id,
        cameraName: cam.name,
        rtspBase,
        db: this.db,
        logger: this.logger.child({ mod: "recorder", cameraId: cam.id }),
        thumbs: this.thumbs,
      });
      try {
        await recorder.start();
        this.recorders.set(cam.id, recorder);
      } catch (err) {
        this.logger.error({ err, cameraId: cam.id }, "recorder failed to start");
      }
    }
  }

  /** Restart the recorder for a specific camera (used when its RTSP URL changes). */
  async restartCamera(cameraId: string): Promise<void> {
    const existing = this.recorders.get(cameraId);
    if (existing) {
      await existing.stop();
      this.recorders.delete(cameraId);
    }
    const cam = this.db
      .select()
      .from(cameras)
      .where(eq(cameras.id, cameraId))
      .get();
    if (!cam || !cam.enabled) return;
    await this.sync();
  }
}
