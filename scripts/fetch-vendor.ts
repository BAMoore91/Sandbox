/**
 * Downloads + extracts the bundled native binaries the NVR ships with:
 *   - go2rtc  (RTSP/ONVIF -> WebRTC/HLS streaming)
 *   - ffmpeg + ffprobe  (recording, thumbnails, stream probing)
 *
 * Default behaviour: fetch binaries for the *host* OS/arch into
 *   vendor/go2rtc/<os>/
 *   vendor/ffmpeg/<os>/
 *
 * Override with --target=linux  /  --target=windows  /  --target=all
 *
 * No external deps — uses node:fetch + the system `tar` and `unzip` /
 * `Expand-Archive` shipped with the OS.
 */

import {
  mkdirSync,
  existsSync,
  chmodSync,
  createWriteStream,
  rmSync,
  readdirSync,
  statSync,
  copyFileSync,
} from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { platform, arch } from "node:os";
import { spawnSync } from "node:child_process";
import { Readable } from "node:stream";
import { finished } from "node:stream/promises";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");

const GO2RTC_VERSION = "1.9.7";
// FFmpeg: linux uses johnvansickle static builds (well-known), windows uses
// BtbN's GitHub-hosted essentials build. Both are LGPL safe.
const FFMPEG_LINUX_URL =
  "https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz";
const FFMPEG_WIN_URL =
  "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-lgpl-shared.zip";

type Os = "linux" | "windows";

interface Target {
  os: Os;
  arch: "amd64" | "arm64";
}

function detectHostTarget(): Target {
  const a = arch();
  const archMapped = a === "arm64" || a === "aarch64" ? "arm64" : "amd64";
  const p = platform();
  if (p === "linux") return { os: "linux", arch: archMapped };
  if (p === "win32") return { os: "windows", arch: archMapped };
  if (p === "darwin") {
    console.warn(
      "[fetch-vendor] macOS is not a supported NVR host; fetching linux binaries.",
    );
    return { os: "linux", arch: archMapped };
  }
  throw new Error(`unsupported host platform: ${p}`);
}

function parseTargets(): Target[] {
  const arg = process.argv.find((a) => a.startsWith("--target="));
  const value = arg?.split("=")[1] ?? "host";
  if (value === "host") return [detectHostTarget()];
  if (value === "all") {
    return [
      { os: "linux", arch: "amd64" },
      { os: "windows", arch: "amd64" },
    ];
  }
  if (value === "linux") return [{ os: "linux", arch: "amd64" }];
  if (value === "windows") return [{ os: "windows", arch: "amd64" }];
  throw new Error(`unknown --target=${value}`);
}

function go2rtcUrl(t: Target): { url: string; binName: string } {
  // Asset naming from https://github.com/AlexxIT/go2rtc/releases
  const tag = `v${GO2RTC_VERSION}`;
  const base = `https://github.com/AlexxIT/go2rtc/releases/download/${tag}`;
  if (t.os === "linux" && t.arch === "amd64")
    return { url: `${base}/go2rtc_linux_amd64`, binName: "go2rtc" };
  if (t.os === "linux" && t.arch === "arm64")
    return { url: `${base}/go2rtc_linux_arm64`, binName: "go2rtc" };
  if (t.os === "windows")
    return { url: `${base}/go2rtc_win64.zip`, binName: "go2rtc.exe" };
  throw new Error(`unsupported go2rtc target: ${t.os}/${t.arch}`);
}

async function download(url: string, dest: string): Promise<void> {
  console.log(`[fetch-vendor]   GET ${url}`);
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  mkdirSync(dirname(dest), { recursive: true });
  const out = createWriteStream(dest);
  await finished(Readable.fromWeb(res.body as never).pipe(out));
}

function run(cmd: string, args: string[], cwd?: string): void {
  const r = spawnSync(cmd, args, { stdio: "inherit", cwd });
  if (r.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} exited with status ${r.status}`);
  }
}

function ensureDir(p: string): void {
  mkdirSync(p, { recursive: true });
}

async function fetchGo2rtc(t: Target): Promise<void> {
  const outDir = join(repoRoot, "vendor", "go2rtc", t.os);
  const { url, binName } = go2rtcUrl(t);
  const finalPath = join(outDir, binName);
  if (existsSync(finalPath)) {
    console.log(`[fetch-vendor] go2rtc[${t.os}] already present at ${finalPath}`);
    return;
  }
  ensureDir(outDir);

  if (t.os === "windows") {
    const tmpZip = join(outDir, "go2rtc.zip");
    await download(url, tmpZip);
    // Use unzip on POSIX, Expand-Archive on Windows
    if (platform() === "win32") {
      run("powershell", [
        "-NoProfile",
        "-Command",
        `Expand-Archive -Force -Path '${tmpZip}' -DestinationPath '${outDir}'`,
      ]);
    } else {
      run("unzip", ["-o", tmpZip, "-d", outDir]);
    }
    rmSync(tmpZip);
  } else {
    await download(url, finalPath);
    if (platform() !== "win32") chmodSync(finalPath, 0o755);
  }
  console.log(`[fetch-vendor] go2rtc[${t.os}] -> ${finalPath}`);
}

async function fetchFfmpeg(t: Target): Promise<void> {
  const outDir = join(repoRoot, "vendor", "ffmpeg", t.os);
  const probeName = t.os === "windows" ? "ffmpeg.exe" : "ffmpeg";
  const finalProbe = join(outDir, probeName);
  if (existsSync(finalProbe)) {
    console.log(`[fetch-vendor] ffmpeg[${t.os}] already present at ${finalProbe}`);
    return;
  }
  ensureDir(outDir);

  if (t.os === "linux") {
    const tmpTar = join(outDir, "ffmpeg.tar.xz");
    await download(FFMPEG_LINUX_URL, tmpTar);
    const tmpExtract = join(outDir, "_extract");
    ensureDir(tmpExtract);
    run("tar", ["-xJf", tmpTar, "-C", tmpExtract]);
    rmSync(tmpTar);
    // Archive contains a single top-level dir like ffmpeg-7.0.2-amd64-static/
    const inner = findFirstSubdir(tmpExtract);
    copyFileSync(join(inner, "ffmpeg"), join(outDir, "ffmpeg"));
    copyFileSync(join(inner, "ffprobe"), join(outDir, "ffprobe"));
    rmSync(tmpExtract, { recursive: true, force: true });
    chmodSync(join(outDir, "ffmpeg"), 0o755);
    chmodSync(join(outDir, "ffprobe"), 0o755);
  } else {
    const tmpZip = join(outDir, "ffmpeg.zip");
    await download(FFMPEG_WIN_URL, tmpZip);
    const tmpExtract = join(outDir, "_extract");
    ensureDir(tmpExtract);
    if (platform() === "win32") {
      run("powershell", [
        "-NoProfile",
        "-Command",
        `Expand-Archive -Force -Path '${tmpZip}' -DestinationPath '${tmpExtract}'`,
      ]);
    } else {
      run("unzip", ["-o", tmpZip, "-d", tmpExtract]);
    }
    rmSync(tmpZip);
    // BtbN archive structure: <top>/bin/{ffmpeg.exe,ffprobe.exe,*.dll}
    const inner = findFirstSubdir(tmpExtract);
    const binDir = join(inner, "bin");
    for (const entry of readdirSync(binDir)) {
      if (
        entry === "ffmpeg.exe" ||
        entry === "ffprobe.exe" ||
        entry.endsWith(".dll")
      ) {
        copyFileSync(join(binDir, entry), join(outDir, entry));
      }
    }
    rmSync(tmpExtract, { recursive: true, force: true });
  }
  console.log(`[fetch-vendor] ffmpeg[${t.os}] -> ${outDir}`);
}

function findFirstSubdir(parent: string): string {
  for (const name of readdirSync(parent)) {
    const full = join(parent, name);
    if (statSync(full).isDirectory()) return full;
  }
  throw new Error(`no subdirectory found in ${parent}`);
}


async function main() {
  const targets = parseTargets();
  console.log(
    `[fetch-vendor] targets: ${targets.map((t) => `${t.os}/${t.arch}`).join(", ")}`,
  );
  for (const t of targets) {
    await fetchGo2rtc(t);
    await fetchFfmpeg(t);
  }
  console.log("[fetch-vendor] done.");
}

main().catch((err) => {
  console.error("[fetch-vendor] failed:", err);
  process.exit(1);
});
