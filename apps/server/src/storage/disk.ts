import { stat, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { dataPaths } from "../platform/paths.js";

/**
 * Recursively sums the size of files under a directory. Returns 0 if the
 * directory does not exist. Best-effort: ignores entries we can't stat.
 */
export async function dirSize(dir: string): Promise<number> {
  let total = 0;
  let entries: Awaited<ReturnType<typeof readdir>>;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    try {
      if (entry.isDirectory()) {
        total += await dirSize(full);
      } else if (entry.isFile()) {
        const s = await stat(full);
        total += s.size;
      }
    } catch {
      // skip
    }
  }
  return total;
}

export async function recordingsDiskBytes(): Promise<number> {
  return dirSize(dataPaths().recordings);
}

export async function unlinkIfExists(path: string): Promise<boolean> {
  try {
    await unlink(path);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
}
