import { defineConfig } from "drizzle-kit";
import { dataPaths } from "./src/platform/paths.js";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dialect: "sqlite",
  dbCredentials: {
    url: dataPaths().database,
  },
});
