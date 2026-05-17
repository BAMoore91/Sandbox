import { watch, stat, readdir } from "node:fs/promises";
import { join, basename } from "node:path";
import { randomUUID } from "node:crypto";
import type { Logger } from "pino";
import { sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { recordings } from "../db/schema.js";
import { ThumbnailGenerator } from "./thumbnails.js";

const SEGMENT_FILENAME_RE = /^(\d+)\.mp4$/;

/**
 * Parses our chosen segment filename pattern. ffmpeg is invoked with
 * `-strftime 1` and output template `<epoch>.mp4`, where epoch is the
 * `%s` token = wall-clock seconds at segment start (timezone-free).
 */
export function parseSegmentTime(filename: string): Date | null {
  const m = SEGMENT_FILENAME_RE.exec(filename);
  if (!m) return null;
  return new Date(Number(m[1]) * 1000);
}

interface IndexerOptions {
  cameraId: string;
  dir: string;
  db: Db;
  logger: Logger;
  /** Codec we expect for the segments (e.g. 'h264' / 'h265'). */
  codecHint?: string;
  thumbs?: ThumbnailGenerator;
}

/**
 * Watches a camera's recording directory. Tracks the currently-growing
 * segment; when a new `.mp4` appears, the previous one is now closed and
 * gets stat'd + inserted into the `recordings` table (and thumbnailed).
 *
 * Robust to restarts: on start(), any orphan `.mp4` files that aren't yet
 * indexed (or whose mtime hasn't been touched for >30s) are finalized.
 */
export class SegmentIndexer {
  private currentFile: string | null = null;
  private aborter: AbortController | null = null;
  private opts: IndexerOptions;

  constructor(opts: IndexerOptions) {
    this.opts = opts;
  }

  async start(): Promise<void> {
    await this.finalizeOrphans();
    this.aborter = new AbortController();
    void this.watchLoop(this.aborter.signal);
  }

  async stop(): Promise<void> {
    this.aborter?.abort();
    this.aborter = null;
    // Finalize whatever was being written when we shut down.
    if (this.currentFile) {
      const path = this.currentFile;
      this.currentFile = null;
      await this.indexFile(path);
    }
  }

  private async watchLoop(signal: AbortSignal): Promise<void> {
    try {
      for await (const event of watch(this.opts.dir, { signal })) {
        if (!event.filename) continue;
        if (!event.filename.endsWith(".mp4")) continue;
        const fullPath = join(this.opts.dir, event.filename);

        let exists = false;
        try {
          await stat(fullPath);
          exists = true;
        } catch {
          // file was deleted (e.g., by retention); ignore
        }
        if (!exists) continue;

        if (this.currentFile && this.currentFile !== fullPath) {
          const prev = this.currentFile;
          this.currentFile = fullPath;
          // Don't block the watch loop on indexing
          void this.indexFile(prev);
        } else if (!this.currentFile) {
          this.currentFile = fullPath;
        }
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      this.opts.logger.error(
        { err, dir: this.opts.dir },
        "segment watcher crashed",
      );
    }
  }

  /**
   * On startup, finalize any segments that were written before this run
   * (e.g., the previous server died mid-recording).
   */
  private async finalizeOrphans(): Promise<void> {
    let entries;
    try {
      entries = await readdir(this.opts.dir, { withFileTypes: true });
    } catch {
      return;
    }
    const mp4Files = entries
      .filter((e) => e.isFile() && e.name.endsWith(".mp4"))
      .map((e) => e.name)
      .sort();
    if (mp4Files.length === 0) return;

    // Anything older than 5 minutes ago without a DB row is an orphan.
    const cutoff = Date.now() - 5 * 60_000;
    for (const name of mp4Files) {
      const full = join(this.opts.dir, name);
      let s;
      try {
        s = await stat(full);
      } catch {
        continue;
      }
      if (s.mtimeMs > cutoff) continue;
      // Best-effort: indexFile() will no-op if already indexed (UNIQUE path)
      await this.indexFile(full);
    }
  }

  private async indexFile(filePath: string): Promise<void> {
    try {
      const s = await stat(filePath);
      if (s.size < 1024) {
        // segment muxer aborted before writing real data
        return;
      }
      const filename = basename(filePath);
      const startedAt = parseSegmentTime(filename);
      if (!startedAt) {
        this.opts.logger.warn(
          { filename },
          "skipping unparseable segment filename",
        );
        return;
      }
      const endedAt = new Date(s.mtimeMs);
      const durationMs = Math.max(0, endedAt.getTime() - startedAt.getTime());

      // Skip if we've already indexed this exact file (idempotent restart)
      const existing = this.opts.db
        .select({ id: recordings.id })
        .from(recordings)
        .where(sql`${recordings.filePath} = ${filePath}`)
        .get();
      if (existing) return;

      const id = randomUUID();
      this.opts.db
        .insert(recordings)
        .values({
          id,
          cameraId: this.opts.cameraId,
          filePath,
          startedAt,
          endedAt,
          durationMs,
          sizeBytes: s.size,
          codec: this.opts.codecHint ?? "h264",
        })
        .run();
      this.opts.logger.info(
        {
          cameraId: this.opts.cameraId,
          filename,
          durationMs,
          sizeBytes: s.size,
        },
        "indexed segment",
      );

      if (this.opts.thumbs) {
        await this.opts.thumbs.generate({
          recordingId: id,
          cameraId: this.opts.cameraId,
          segmentPath: filePath,
          durationMs,
        });
      }
    } catch (err) {
      this.opts.logger.warn({ err, filePath }, "indexFile failed");
    }
  }
}
