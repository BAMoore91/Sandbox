import type { FastifyPluginAsync } from "fastify";
import { eq } from "drizzle-orm";
import WebSocket from "ws";
import type { Db } from "../db/client.js";
import { cameras } from "../db/schema.js";
import {
  type Go2rtcService,
  streamName,
  subStreamName,
} from "../streaming/go2rtc.js";
import {
  signStreamTicket,
  verifyStreamTicket,
} from "../streaming/tickets.js";

interface Opts {
  db: Db;
  go2rtc: Go2rtcService;
  jwtSecret: string;
}

/**
 * Routes mounted under /api/streams (HTTP) and /ws (upgrade).
 *
 * - POST /api/streams/:id/ticket   → returns a 60s scoped ticket
 * - GET  /ws/stream/:id?ticket=... → WebRTC signaling proxy to go2rtc
 */
export const streamRoutes: FastifyPluginAsync<Opts> = async (
  app,
  { db, go2rtc, jwtSecret },
) => {
  app.post<{
    Params: { cameraId: string };
    Querystring: { kind?: "main" | "sub" };
  }>(
    "/api/streams/:cameraId/ticket",
    { preHandler: app.requireAuth },
    async (req, reply) => {
      const { cameraId } = req.params;
      const cam = db
        .select()
        .from(cameras)
        .where(eq(cameras.id, cameraId))
        .get();
      if (!cam || !cam.enabled) {
        return reply.code(404).send({ error: "not_found" });
      }
      const requestedKind = req.query.kind === "sub" ? "sub" : "main";
      // Fall back to main if sub-stream wasn't configured
      const kind: "main" | "sub" =
        requestedKind === "sub" && cam.subRtspUrl ? "sub" : "main";

      const { token, expiresIn } = signStreamTicket(
        {
          cameraId,
          userId: req.authUser!.id,
          kind,
        },
        jwtSecret,
      );
      return { ticket: token, kind, expiresIn };
    },
  );

  app.get<{
    Params: { cameraId: string };
    Querystring: { ticket?: string; kind?: "main" | "sub" };
  }>(
    "/ws/stream/:cameraId",
    { websocket: true },
    (browserSocket, req) => {
      const ticket = req.query.ticket;
      if (!ticket) {
        browserSocket.close(4401, "missing_ticket");
        return;
      }
      const decoded = verifyStreamTicket(ticket, jwtSecret);
      if (!decoded) {
        browserSocket.close(4401, "invalid_ticket");
        return;
      }
      if (decoded.cameraId !== req.params.cameraId) {
        browserSocket.close(4403, "ticket_camera_mismatch");
        return;
      }

      const cam = db
        .select()
        .from(cameras)
        .where(eq(cameras.id, decoded.cameraId))
        .get();
      if (!cam || !cam.enabled) {
        browserSocket.close(4404, "camera_not_found");
        return;
      }
      if (!go2rtc.isRunning()) {
        browserSocket.close(4503, "streaming_unavailable");
        return;
      }

      const streamId =
        decoded.kind === "sub" && cam.subRtspUrl
          ? subStreamName(cam.id)
          : streamName(cam.id);
      const ports = go2rtc.getPorts();
      const upstreamUrl = `ws://${ports.apiHost}:${ports.apiPort}/api/ws?src=${encodeURIComponent(streamId)}`;

      const upstream = new WebSocket(upstreamUrl);
      const buffered: WebSocket.RawData[] = [];
      let upstreamReady = false;
      let closed = false;

      const closeBoth = (code: number, reason: string) => {
        if (closed) return;
        closed = true;
        try {
          if (upstream.readyState === WebSocket.OPEN) upstream.close(code, reason);
        } catch {}
        try {
          if (browserSocket.readyState === WebSocket.OPEN)
            browserSocket.close(code, reason);
        } catch {}
      };

      upstream.on("open", () => {
        upstreamReady = true;
        for (const msg of buffered) upstream.send(msg);
        buffered.length = 0;
      });
      upstream.on("message", (data) => {
        if (browserSocket.readyState === WebSocket.OPEN) {
          browserSocket.send(data);
        }
      });
      upstream.on("close", (code, reason) => {
        // Translate non-standard upstream codes into a safe close code for the browser
        const safeCode = code >= 1000 && code <= 4999 ? code : 1011;
        closeBoth(safeCode, reason?.toString() ?? "");
      });
      upstream.on("error", (err) => {
        req.log.warn({ err, streamId }, "go2rtc upstream error");
        closeBoth(1011, "upstream_error");
      });

      browserSocket.on("message", (data) => {
        if (upstreamReady && upstream.readyState === WebSocket.OPEN) {
          upstream.send(data);
        } else {
          buffered.push(data);
        }
      });
      browserSocket.on("close", () => closeBoth(1000, "client_closed"));
      browserSocket.on("error", () => closeBoth(1011, "client_error"));
    },
  );
};
