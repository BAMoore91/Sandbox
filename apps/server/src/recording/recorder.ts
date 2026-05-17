import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Logger } from "pino";
import { Supervisor } from "../platform/supervisor.js";
import { resolveFfmpeg } from "../platform/vendor.js";
import { dataPaths } from "../platform/paths.js";
import { streamName } from "../streaming/go2rtc.js";
import type { Db } from "../db/client.js";
import { SegmentIndexer } from "./indexer.js";
import { ThumbnailGenerator } from "./thumbnails.js";

const SEGMENT_SECONDS = 300; // 5-minute segments

interface RecorderOptions {
  cameraId: string;
  cameraName: string;
  /** RTSP base, e.g. rtsp://127.0.0.1:8554 (go2rtc local server) */
  rtspBase: string;
  db: Db;
  logger: Logger;
  thumbs: ThumbnailGenerator;
}

/**
 * Records one camera. Pulls from go2rtc's local RTSP server with no
 * re-encoding (`-c copy`), segments to 5-minute MP4 files named by
 * Unix epoch seconds (`%s.mp4`). A `SegmentIndexer` watches the dir
 * and writes one DB row per closed segment plus a thumbnail.
 *
 * The whole pipeline survives camera/disk hiccups via Supervisor's
 * exponential-backoff restart.
 */
export class CameraRecorder {
  private supervisor: Supervisor | null = null;
  private indexer: SegmentIndexer;
  private readonly outputDir: string;

  constructor(private readonly opts: RecorderOptions) {
    this.outputDir = join(dataPaths().recordings, opts.cameraId);
    this.indexer = new SegmentIndexer({
      cameraId: opts.cameraId,
      dir: this.outputDir,
      db: opts.db,
      logger: opts.logger,
      thumbs: opts.thumbs,
    });
  }

  isRunning(): boolean {
    return this.supervisor?.isRunning() ?? false;
  }

  async start(): Promise<void> {
    mkdirSync(this.outputDir, { recursive: true });
    await this.indexer.start();

    const ffmpeg = resolveFfmpeg();
    const src = `${this.opts.rtspBase}/${streamName(this.opts.cameraId)}`;
    const outputPattern = join(this.outputDir, "%s.mp4");

    const args = [
      "-loglevel",
      "warning",
      "-rtsp_transport",
      "tcp",
      // Reconnect / read-timeout flags so the supervisor isn't the only line of defense
      "-stimeout",
      "5000000", // 5s in microseconds
      "-i",
      src,
      "-c",
      "copy",
      "-an", // no audio track in segments for Phase 3; can flip on per-camera later
      "-f",
      "segment",
      "-segment_time",
      String(SEGMENT_SECONDS),
      "-segment_format",
      "mp4",
      "-reset_timestamps",
      "1",
      "-strftime",
      "1",
      "-y",
      outputPattern,
    ];

    this.supervisor = new Supervisor({
      name: `recorder/${this.opts.cameraName}`,
      command: ffmpeg,
      args,
      logger: this.opts.logger,
      restartDelayMs: 2000,
      maxRestartDelayMs: 60_000,
      shutdownGraceMs: 8000,
    });
    await this.supervisor.start();
  }

  async stop(): Promise<void> {
    if (this.supervisor) {
      await this.supervisor.stop();
      this.supervisor = null;
    }
    await this.indexer.stop();
  }
}
