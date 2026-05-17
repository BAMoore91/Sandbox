import pino from "pino";
import type { Config } from "./config.js";

export function createLogger(config: Config) {
  return pino({
    level: config.logLevel,
    transport:
      process.env.NODE_ENV === "production"
        ? undefined
        : {
            target: "pino-pretty",
            options: {
              colorize: true,
              translateTime: "SYS:HH:MM:ss.l",
              ignore: "pid,hostname",
            },
          },
  });
}

export type Logger = ReturnType<typeof createLogger>;
