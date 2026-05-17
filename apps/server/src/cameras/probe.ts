import { spawn } from "node:child_process";
import { resolveFfprobe, vendorStatus } from "../platform/vendor.js";

export interface ProbeStream {
  codec: string;
  type: "video" | "audio" | "other";
  width?: number;
  height?: number;
  fps?: number;
  channels?: number;
  sampleRate?: number;
}

export interface ProbeResult {
  ok: boolean;
  durationSec?: number;
  bitrate?: number;
  streams: ProbeStream[];
  raw?: unknown;
  error?: string;
}

interface FfprobeStream {
  codec_name?: string;
  codec_type?: "video" | "audio" | string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  channels?: number;
  sample_rate?: string;
}
interface FfprobeOutput {
  streams?: FfprobeStream[];
  format?: { duration?: string; bit_rate?: string };
}

function parseFps(fr?: string): number | undefined {
  if (!fr) return undefined;
  const [num, den] = fr.split("/").map(Number);
  if (!num || !den) return undefined;
  return Math.round((num / den) * 100) / 100;
}

/**
 * Probe an RTSP (or any ffprobe-supported) URL with a short timeout.
 * Returns codec/resolution/audio info. Used both for "Add camera" preflight
 * and stored on the recording row when segments are written.
 */
export async function probeStream(
  url: string,
  timeoutMs = 8000,
): Promise<ProbeResult> {
  if (!vendorStatus().ffprobe) {
    return {
      ok: false,
      streams: [],
      error: "ffprobe not installed — run `pnpm fetch-vendor` to enable stream probing.",
    };
  }
  const bin = resolveFfprobe();
  const args = [
    "-v",
    "error",
    "-rtsp_transport",
    "tcp",
    "-stimeout",
    String(timeoutMs * 1000), // microseconds
    "-print_format",
    "json",
    "-show_format",
    "-show_streams",
    url,
  ];

  return new Promise<ProbeResult>((resolve) => {
    const child = spawn(bin, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, timeoutMs + 1000);

    child.stdout.on("data", (b: Buffer) => (out += b.toString("utf8")));
    child.stderr.on("data", (b: Buffer) => (err += b.toString("utf8")));

    child.once("error", (e) => {
      clearTimeout(timer);
      resolve({ ok: false, streams: [], error: e.message });
    });

    child.once("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        resolve({
          ok: false,
          streams: [],
          error: err.trim() || `ffprobe exited ${code}`,
        });
        return;
      }
      try {
        const parsed = JSON.parse(out) as FfprobeOutput;
        const streams: ProbeStream[] = (parsed.streams ?? []).map((s) => ({
          codec: s.codec_name ?? "unknown",
          type:
            s.codec_type === "video"
              ? "video"
              : s.codec_type === "audio"
                ? "audio"
                : "other",
          ...(s.width !== undefined ? { width: s.width } : {}),
          ...(s.height !== undefined ? { height: s.height } : {}),
          ...(parseFps(s.avg_frame_rate) !== undefined
            ? { fps: parseFps(s.avg_frame_rate) }
            : {}),
          ...(s.channels !== undefined ? { channels: s.channels } : {}),
          ...(s.sample_rate !== undefined
            ? { sampleRate: Number(s.sample_rate) }
            : {}),
        }));
        const duration = parsed.format?.duration
          ? Number(parsed.format.duration)
          : undefined;
        const bitrate = parsed.format?.bit_rate
          ? Number(parsed.format.bit_rate)
          : undefined;
        resolve({
          ok: true,
          streams,
          ...(duration !== undefined && !Number.isNaN(duration)
            ? { durationSec: duration }
            : {}),
          ...(bitrate !== undefined && !Number.isNaN(bitrate)
            ? { bitrate }
            : {}),
          raw: parsed,
        });
      } catch (e) {
        resolve({
          ok: false,
          streams: [],
          error: `failed to parse ffprobe output: ${(e as Error).message}`,
        });
      }
    });
  });
}
