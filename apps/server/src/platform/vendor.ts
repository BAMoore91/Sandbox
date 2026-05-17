import { existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { platform } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Possible roots to search for `vendor/go2rtc/...` and `vendor/ffmpeg/...`,
 * in priority order:
 *   1. SOFTBISCUIT_VENDOR_DIR env override
 *   2. Walk up from this file (dev mode: <repo>/vendor)
 *   3. /usr/lib/softbiscuit/vendor (Linux install)
 *   4. <exeDir>/vendor (Windows install — exe lives in Program Files)
 */
function candidateRoots(): string[] {
  const roots: string[] = [];
  if (process.env.SOFTBISCUIT_VENDOR_DIR) {
    roots.push(process.env.SOFTBISCUIT_VENDOR_DIR);
  }
  // Walk up from this file looking for a `vendor/` dir (works for both
  // src/ during dev and dist/ in build).
  let dir = here;
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, "vendor");
    if (existsSync(candidate)) {
      roots.push(candidate);
      break;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  if (platform() === "linux") {
    roots.push("/usr/lib/softbiscuit/vendor");
  }
  if (platform() === "win32") {
    roots.push(join(dirname(process.execPath), "vendor"));
  }
  return roots;
}

function osKey(): "linux" | "windows" | "macos" {
  switch (platform()) {
    case "linux":
      return "linux";
    case "win32":
      return "windows";
    case "darwin":
      return "macos";
    default:
      return "linux";
  }
}

function exeName(name: string): string {
  return platform() === "win32" ? `${name}.exe` : name;
}

function findBinary(tool: "go2rtc" | "ffmpeg" | "ffprobe"): string | null {
  const binary = exeName(tool);
  // go2rtc has its own dir; ffmpeg and ffprobe share the ffmpeg/<os> dir
  const subdir = tool === "go2rtc" ? "go2rtc" : "ffmpeg";
  for (const root of candidateRoots()) {
    const full = join(root, subdir, osKey(), binary);
    if (existsSync(full)) return resolve(full);
  }
  return null;
}

export function resolveGo2rtc(): string {
  const p = findBinary("go2rtc");
  if (!p) {
    throw new Error(
      "go2rtc binary not found. Run `pnpm fetch-vendor` to download it.",
    );
  }
  return p;
}

export function resolveFfmpeg(): string {
  const p = findBinary("ffmpeg");
  if (!p) {
    throw new Error(
      "ffmpeg binary not found. Run `pnpm fetch-vendor` to download it.",
    );
  }
  return p;
}

export function resolveFfprobe(): string {
  const p = findBinary("ffprobe");
  if (!p) {
    throw new Error(
      "ffprobe binary not found. Run `pnpm fetch-vendor` to download it.",
    );
  }
  return p;
}

/** Probe presence without throwing — useful for health endpoints. */
export function vendorStatus(): {
  go2rtc: string | null;
  ffmpeg: string | null;
  ffprobe: string | null;
} {
  return {
    go2rtc: findBinary("go2rtc"),
    ffmpeg: findBinary("ffmpeg"),
    ffprobe: findBinary("ffprobe"),
  };
}
