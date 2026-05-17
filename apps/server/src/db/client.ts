import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { dataPaths } from "../platform/paths.js";
import * as schema from "./schema.js";

export type Db = ReturnType<typeof drizzle<typeof schema>>;

export function openDb(): Db {
  const path = dataPaths().database;
  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("synchronous = NORMAL");
  return drizzle(sqlite, { schema });
}

export function runMigrations(db: Db): void {
  const here = dirname(fileURLToPath(import.meta.url));
  migrate(db, { migrationsFolder: join(here, "migrations") });
}
