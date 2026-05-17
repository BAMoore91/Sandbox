import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir, platform } from "node:os";

export interface DataPaths {
  root: string;
  database: string;
  recordings: string;
  thumbnails: string;
  logs: string;
  secrets: string;
}

function resolveRoot(): string {
  const override = process.env.SOFTBISCUIT_DATA_DIR;
  if (override) return override;

  switch (platform()) {
    case "linux":
      return process.getuid?.() === 0
        ? "/var/lib/softbiscuit"
        : join(homedir(), ".local", "share", "softbiscuit");
    case "win32":
      return join(
        process.env.PROGRAMDATA ?? "C:\\ProgramData",
        "SoftBiscuit",
      );
    case "darwin":
      return join(homedir(), "Library", "Application Support", "SoftBiscuit");
    default:
      return join(homedir(), ".softbiscuit");
  }
}

let cached: DataPaths | undefined;

export function dataPaths(): DataPaths {
  if (cached) return cached;
  const root = resolveRoot();
  cached = {
    root,
    database: join(root, "softbiscuit.sqlite"),
    recordings: join(root, "recordings"),
    thumbnails: join(root, "thumbnails"),
    logs: join(root, "logs"),
    secrets: join(root, "secrets"),
  };
  return cached;
}

export function ensureDataDirs(): DataPaths {
  const p = dataPaths();
  for (const dir of [p.root, p.recordings, p.thumbnails, p.logs, p.secrets]) {
    mkdirSync(dir, { recursive: true });
  }
  return p;
}
