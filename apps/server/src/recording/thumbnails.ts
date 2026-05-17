import { mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";
import type { Logger } from "pino";
import { dataPaths } from "../platform/paths.js";
import { resolveFfmpeg } from "../platform/vendor.js";

interface GenerateArgs {
  recordingId: string;
  cameraId: string;
  segmentPath: string;
  durationMs: number;
}

/**
 * One JPEG per recorded segment, taken at the segment's midpoint.
 * Stored at `<data>/thumbnails/<cameraId>/<recordingId>.jpg`.
 *
 * Used by the Timeline UI for hover previews and by the Events page
 * (Phase 4) for the detection thumbnail when no AI snapshot exists.
 */
export class ThumbnailGenerator {
  constructor(
    private readonly logger: Logger,
    /** Width in pixels of the generated JPEG. */
    private readonly width = 320,
    /** JPEG quality (2..31; lower is better). */
    private readonly quality = 5,
  ) {}

  thumbnailPath(cameraId: string, recordingId: string): string {
    return join(
      dataPaths().thumbnails,
      cameraId,
      `${recordingId}.jpg`,
    );
  }

  async generate(args: GenerateArgs): Promise<string | null> {
    const outDir = join(dataPaths().thumbnails, args.cameraId);
    await mkdir(outDir, { recursive: true });
    const outPath = this.thumbnailPath(args.cameraId, args.recordingId);

    const ffmpeg = resolveFfmpeg();
    const offsetSec = Math.max(0, Math.floor(args.durationMs / 2000));
    const ffmpegArgs = [
      "-loglevel",
      "error",
      "-ss",
      String(offsetSec),
      "-i",
      args.segmentPath,
      "-frames:v",
      "1",
      "-q:v",
      String(this.quality),
      "-vf",
      `scale=${this.width}:-2`,
      "-y",
      outPath,
    ];

    return new Promise<string | null>((resolve) => {
      const child = spawn(ffmpeg, ffmpegArgs, {
        stdio: ["ignore", "ignore", "pipe"],
        windowsHide: true,
      });
      let err = "";
      child.stderr.on("data", (b: Buffer) => (err += b.toString("utf8")));
      child.once("error", (e) => {
        this.logger.warn({ err: e }, "thumbnail ffmpeg spawn failed");
        resolve(null);
      });
      child.once("close", (code) => {
        if (code === 0) {
          resolve(outPath);
        } else {
          this.logger.warn(
            { err: err.trim(), code, recordingId: args.recordingId },
            "thumbnail generation failed",
          );
          resolve(null);
        }
      });
    });
  }
}
