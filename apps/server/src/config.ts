import { readFileSync, writeFileSync, existsSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { ensureDataDirs } from "./platform/paths.js";

const ConfigSchema = z.object({
  host: z.string().default("127.0.0.1"),
  port: z.number().int().min(1).max(65535).default(8088),
  jwtSecret: z.string().min(32),
  logLevel: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),
});

export type Config = z.infer<typeof ConfigSchema>;

function loadOrCreateJwtSecret(secretsDir: string): string {
  const file = join(secretsDir, "jwt.secret");
  if (existsSync(file)) {
    return readFileSync(file, "utf8").trim();
  }
  const secret = randomBytes(48).toString("base64url");
  writeFileSync(file, secret + "\n", { mode: 0o600 });
  if (process.platform !== "win32") chmodSync(file, 0o600);
  return secret;
}

export function loadConfig(): Config {
  const paths = ensureDataDirs();
  return ConfigSchema.parse({
    host: process.env.SOFTBISCUIT_HOST ?? "127.0.0.1",
    port: process.env.SOFTBISCUIT_PORT
      ? Number(process.env.SOFTBISCUIT_PORT)
      : 8088,
    jwtSecret:
      process.env.SOFTBISCUIT_JWT_SECRET ?? loadOrCreateJwtSecret(paths.secrets),
    logLevel: (process.env.SOFTBISCUIT_LOG_LEVEL ?? "info") as Config["logLevel"],
  });
}
