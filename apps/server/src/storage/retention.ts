import type { Logger } from "pino";
import { and, asc, eq, lt } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { cameras, recordings, type Recording } from "../db/schema.js";
import { unlinkIfExists } from "./disk.js";
import { recordingsDiskBytes } from "./disk.js";
import { ThumbnailGenerator } from "../recording/thumbnails.js";

interface RetentionOptions {
  /** Per-camera default in days when the camera doesn't set its own. */
  defaultDays: number;
  /** Optional global cap. When recordings exceed this, oldest segments are
   * deleted across all cameras until under cap. Undefined = no cap. */
  maxDiskBytes?: number;
  /** How often to run, in ms. */
  intervalMs: number;
}

const DEFAULTS: RetentionOptions = {
  defaultDays: 14,
  intervalMs: 60 * 60_000, // hourly
};

/**
 * Two-pass purger:
 *   1. Per-camera age: drop segments older than `retentionDays` (DB column
 *      falls back to `defaultDays`).
 *   2. Global disk cap: if `maxDiskBytes` set, delete oldest-first across
 *      all cameras until under cap.
 *
 * Each deletion removes the .mp4 file, the thumbnail jpg, and the DB row.
 */
export class RetentionService {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private readonly opts: RetentionOptions;
  private readonly thumbs = new ThumbnailGenerator(this.logger);

  constructor(
    private readonly db: Db,
    private readonly logger: Logger,
    opts: Partial<RetentionOptions> = {},
  ) {
    this.opts = { ...DEFAULTS, ...opts };
  }

  start(): void {
    this.timer = setInterval(() => void this.runOnce(), this.opts.intervalMs);
    // Run once at startup, but on a defer so boot isn't blocked
    setTimeout(() => void this.runOnce(), 30_000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async runOnce(): Promise<{ deleted: number; reclaimedBytes: number }> {
    if (this.running) return { deleted: 0, reclaimedBytes: 0 };
    this.running = true;
    let deleted = 0;
    let reclaimedBytes = 0;
    try {
      // Pass 1: per-camera age
      const cams = this.db.select().from(cameras).all();
      for (const cam of cams) {
        const days = cam.retentionDays ?? this.opts.defaultDays;
        const cutoff = new Date(Date.now() - days * 86_400_000);
        const old = this.db
          .select()
          .from(recordings)
          .where(
            and(
              eq(recordings.cameraId, cam.id),
              lt(recordings.startedAt, cutoff),
            ),
          )
          .all();
        for (const r of old) {
          reclaimedBytes += r.sizeBytes;
          await this.delete(r);
          deleted += 1;
        }
      }

      // Pass 2: global disk cap
      if (this.opts.maxDiskBytes) {
        let used = await recordingsDiskBytes();
        if (used > this.opts.maxDiskBytes) {
          const candidates = this.db
            .select()
            .from(recordings)
            .orderBy(asc(recordings.startedAt))
            .all();
          for (const r of candidates) {
            if (used <= this.opts.maxDiskBytes) break;
            await this.delete(r);
            used -= r.sizeBytes;
            reclaimedBytes += r.sizeBytes;
            deleted += 1;
          }
        }
      }

      if (deleted > 0) {
        this.logger.info(
          { deleted, reclaimedBytes },
          "retention pass complete",
        );
      }
    } catch (err) {
      this.logger.error({ err }, "retention pass failed");
    } finally {
      this.running = false;
    }
    return { deleted, reclaimedBytes };
  }

  private async delete(r: Recording): Promise<void> {
    try {
      await unlinkIfExists(r.filePath);
      await unlinkIfExists(this.thumbs.thumbnailPath(r.cameraId, r.id));
    } catch (err) {
      this.logger.warn(
        { err, filePath: r.filePath },
        "retention: file delete failed",
      );
    }
    this.db.delete(recordings).where(eq(recordings.id, r.id)).run();
  }
}
