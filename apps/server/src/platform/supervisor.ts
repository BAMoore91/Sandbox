import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import { EventEmitter } from "node:events";
import treeKill from "tree-kill";
import type { Logger } from "pino";

export interface SupervisorOptions {
  /** Logical name used in logs and metrics. */
  name: string;
  /** Absolute path to the binary. */
  command: string;
  args: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  logger: Logger;
  /** Initial backoff after a crash, in ms. */
  restartDelayMs?: number;
  /** Maximum backoff cap, in ms. */
  maxRestartDelayMs?: number;
  /** SIGTERM-then-SIGKILL grace period. */
  shutdownGraceMs?: number;
  /** If true, stop restarting after first clean exit (code 0). */
  oneShot?: boolean;
}

type State = "stopped" | "starting" | "running" | "stopping" | "crashed";

/**
 * Cross-platform child-process supervisor.
 *
 * - Spawns the binary, pipes stdout/stderr into pino at info/warn levels.
 * - On crash, restarts with exponential backoff up to maxRestartDelayMs.
 * - stop() sends SIGTERM (Linux/mac) / taskkill /T (Windows) via tree-kill,
 *   then SIGKILL after shutdownGraceMs if the child is still alive.
 */
export class Supervisor extends EventEmitter {
  private state: State = "stopped";
  private child: ChildProcessByStdio<null, Readable, Readable> | null = null;
  private currentDelay: number;
  private restartTimer: NodeJS.Timeout | null = null;
  private stopRequested = false;

  constructor(private readonly opts: SupervisorOptions) {
    super();
    this.currentDelay = opts.restartDelayMs ?? 1000;
  }

  isRunning(): boolean {
    return this.state === "running";
  }

  pid(): number | undefined {
    return this.child?.pid;
  }

  async start(): Promise<void> {
    if (this.state === "running" || this.state === "starting") return;
    this.stopRequested = false;
    this.state = "starting";
    this.spawnOnce();
  }

  async stop(): Promise<void> {
    this.stopRequested = true;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    if (!this.child) {
      this.state = "stopped";
      return;
    }
    this.state = "stopping";
    const child = this.child;
    const pid = child.pid;
    if (!pid) {
      this.state = "stopped";
      return;
    }

    const grace = this.opts.shutdownGraceMs ?? 5000;
    return new Promise<void>((resolve) => {
      let resolved = false;
      const done = () => {
        if (resolved) return;
        resolved = true;
        this.state = "stopped";
        this.child = null;
        resolve();
      };
      child.once("exit", done);
      treeKill(pid, "SIGTERM", (err) => {
        if (err) this.opts.logger.warn({ err, name: this.opts.name }, "tree-kill SIGTERM failed");
      });
      setTimeout(() => {
        if (!resolved && child.pid) {
          this.opts.logger.warn(
            { name: this.opts.name, pid: child.pid },
            "graceful shutdown timed out, sending SIGKILL",
          );
          treeKill(child.pid, "SIGKILL", () => {});
        }
      }, grace);
    });
  }

  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  private spawnOnce(): void {
    const { name, command, args, cwd, env, logger } = this.opts;
    logger.info({ name, command, args }, "spawning child process");

    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    this.child = child;
    const log = logger.child({ name, pid: child.pid });

    const pipeLines = (stream: Readable, level: "info" | "warn") => {
      let buf = "";
      stream.on("data", (chunk: Buffer) => {
        buf += chunk.toString("utf8");
        let idx: number;
        while ((idx = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, idx).replace(/\r$/, "");
          buf = buf.slice(idx + 1);
          if (line.length > 0) log[level](line);
        }
      });
    };
    pipeLines(child.stdout, "info");
    pipeLines(child.stderr, "warn");

    child.once("spawn", () => {
      this.state = "running";
      // Reset backoff once the process has been up for 10s
      setTimeout(() => {
        if (this.state === "running") {
          this.currentDelay = this.opts.restartDelayMs ?? 1000;
        }
      }, 10_000);
      this.emit("started", child.pid);
    });

    child.once("error", (err) => {
      log.error({ err }, "spawn error");
    });

    child.once("exit", (code, signal) => {
      this.child = null;
      const wasRequested = this.stopRequested;
      const cleanExit = code === 0;
      log.info({ code, signal, wasRequested }, "child exited");

      if (wasRequested) {
        this.state = "stopped";
        this.emit("stopped", { code, signal });
        return;
      }
      if (this.opts.oneShot && cleanExit) {
        this.state = "stopped";
        this.emit("stopped", { code, signal });
        return;
      }

      this.state = "crashed";
      this.emit("crashed", { code, signal });
      this.scheduleRestart();
    });
  }

  private scheduleRestart(): void {
    if (this.stopRequested) return;
    const max = this.opts.maxRestartDelayMs ?? 30_000;
    const delay = Math.min(this.currentDelay, max);
    this.opts.logger.warn(
      { name: this.opts.name, delayMs: delay },
      "restarting child after backoff",
    );
    this.emit("restarting", delay);
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      this.state = "starting";
      this.spawnOnce();
    }, delay);
    this.currentDelay = Math.min(this.currentDelay * 2, max);
  }
}
