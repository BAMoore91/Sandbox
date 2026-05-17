import { openDb, runMigrations } from "./client.js";
import { ensureDataDirs } from "../platform/paths.js";

ensureDataDirs();
const db = openDb();
runMigrations(db);
console.log("Migrations applied.");
