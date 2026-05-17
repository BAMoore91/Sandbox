import Fastify from "fastify";
import fastifyCors from "@fastify/cors";
import fastifyCookie from "@fastify/cookie";
import fastifySensible from "@fastify/sensible";
import fastifyWebsocket from "@fastify/websocket";
import { ZodError } from "zod";
import { loadConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { ensureDataDirs } from "./platform/paths.js";
import { vendorStatus } from "./platform/vendor.js";
import { openDb, runMigrations } from "./db/client.js";
import authPlugin from "./auth/plugin.js";
import { authRoutes } from "./api/auth.js";
import { userRoutes } from "./api/users.js";
import { cameraRoutes } from "./api/cameras.js";
import { streamRoutes } from "./api/streams.js";
import { Go2rtcService } from "./streaming/go2rtc.js";

import "./auth/types.js";

async function main() {
  ensureDataDirs();
  const config = loadConfig();
  const logger = createLogger(config);

  const db = openDb();
  try {
    runMigrations(db);
  } catch (err) {
    logger.warn(
      { err },
      "Migrations folder not found or failed; run `pnpm db:generate` then `pnpm db:migrate`.",
    );
  }

  const vendor = vendorStatus();
  logger.info({ vendor }, "vendor binaries");

  const go2rtc = new Go2rtcService(db, logger.child({ mod: "go2rtc" }));
  if (vendor.go2rtc) {
    try {
      await go2rtc.start();
    } catch (err) {
      logger.error({ err }, "go2rtc failed to start; camera streaming disabled");
    }
  } else {
    logger.warn(
      "go2rtc binary not found in vendor/; run `pnpm fetch-vendor` to enable live streaming.",
    );
  }

  const app = Fastify({ loggerInstance: logger });

  await app.register(fastifyCors, {
    origin: process.env.NODE_ENV === "production" ? false : true,
    credentials: true,
  });
  await app.register(fastifyCookie);
  await app.register(fastifySensible);
  await app.register(fastifyWebsocket);
  await app.register(authPlugin, { jwtSecret: config.jwtSecret });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) {
      return reply
        .code(400)
        .send({ error: "validation_error", issues: err.issues });
    }
    logger.error({ err }, "request error");
    return reply.code(err.statusCode ?? 500).send({
      error: err.code ?? "internal_error",
      message: err.message,
    });
  });

  app.get("/api/health", async () => ({
    status: "ok",
    version: "0.0.1",
    time: new Date().toISOString(),
    go2rtc: {
      configured: !!vendor.go2rtc,
      running: go2rtc.isRunning(),
      healthy: await go2rtc.health(),
    },
    vendor,
  }));

  await app.register(
    async (api) => {
      await api.register(authRoutes, { db, prefix: "/auth" });
      await api.register(userRoutes, { db, prefix: "/users" });
      await api.register(cameraRoutes, { db, go2rtc, prefix: "/cameras" });
    },
    { prefix: "/api" },
  );

  // streamRoutes registers both /api/streams/... and /ws/stream/...,
  // so it lives at the root and manages its own paths.
  await app.register(streamRoutes, {
    db,
    go2rtc,
    jwtSecret: config.jwtSecret,
  });

  await app.listen({ host: config.host, port: config.port });
  logger.info(
    `SoftBiscuit listening on http://${config.host}:${config.port}`,
  );

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "shutting down");
    try {
      await go2rtc.stop();
    } catch (err) {
      logger.warn({ err }, "go2rtc stop failed");
    }
    await app.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
