import { stat, open } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { and, asc, eq, gte, lte } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client.js";
import { recordings, cameras } from "../db/schema.js";
import { ThumbnailGenerator } from "../recording/thumbnails.js";

const ListQuery = z.object({
  from: z.coerce.number().int().optional(),
  to: z.coerce.number().int().optional(),
});

interface Opts {
  db: Db;
  jwtSecret: string;
}

interface PlaybackTicket {
  recordingId: string;
  userId: string;
  exp: number;
}

function b64url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}
function fromB64url(s: string): Buffer {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

function signPlaybackTicket(
  payload: Omit<PlaybackTicket, "exp">,
  secret: string,
  ttlSec = 5 * 60,
): { token: string; expiresIn: number } {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const body = b64url(Buffer.from(JSON.stringify({ ...payload, exp }), "utf8"));
  const sig = b64url(createHmac("sha256", secret).update(body).digest());
  return { token: `${body}.${sig}`, expiresIn: ttlSec };
}

function verifyPlaybackTicket(
  token: string,
  secret: string,
): PlaybackTicket | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts as [string, string];
  const expected = b64url(createHmac("sha256", secret).update(body).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const decoded = JSON.parse(fromB64url(body).toString("utf8")) as PlaybackTicket;
    if (!decoded.recordingId || !decoded.userId || !decoded.exp) return null;
    if (decoded.exp < Math.floor(Date.now() / 1000)) return null;
    return decoded;
  } catch {
    return null;
  }
}

function parseRangeHeader(
  header: string | undefined,
  size: number,
): { start: number; end: number } | null {
  if (!header || !header.startsWith("bytes=")) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  const sRaw = m[1] ?? "";
  const eRaw = m[2] ?? "";
  let start: number, end: number;
  if (sRaw === "" && eRaw !== "") {
    // suffix range: last N bytes
    end = size - 1;
    start = Math.max(0, size - Number(eRaw));
  } else if (sRaw !== "" && eRaw === "") {
    start = Number(sRaw);
    end = size - 1;
  } else if (sRaw !== "" && eRaw !== "") {
    start = Number(sRaw);
    end = Number(eRaw);
  } else {
    return null;
  }
  if (
    Number.isNaN(start) ||
    Number.isNaN(end) ||
    start > end ||
    start >= size ||
    end >= size
  ) {
    return null;
  }
  return { start, end };
}

export const recordingRoutes: FastifyPluginAsync<Opts> = async (
  app,
  { db, jwtSecret },
) => {
  const thumbs = new ThumbnailGenerator(app.log);

  // List recordings for a camera within an optional time range
  app.get<{ Params: { cameraId: string }; Querystring: z.infer<typeof ListQuery> }>(
    "/cameras/:cameraId/recordings",
    { preHandler: app.requireAuth },
    async (req, reply) => {
      const cam = db
        .select({ id: cameras.id })
        .from(cameras)
        .where(eq(cameras.id, req.params.cameraId))
        .get();
      if (!cam) return reply.code(404).send({ error: "not_found" });
      const q = ListQuery.parse(req.query);
      const wheres = [eq(recordings.cameraId, req.params.cameraId)];
      if (q.from !== undefined) wheres.push(gte(recordings.endedAt, new Date(q.from)));
      if (q.to !== undefined) wheres.push(lte(recordings.startedAt, new Date(q.to)));
      const rows = db
        .select({
          id: recordings.id,
          startedAt: recordings.startedAt,
          endedAt: recordings.endedAt,
          durationMs: recordings.durationMs,
          sizeBytes: recordings.sizeBytes,
          codec: recordings.codec,
          width: recordings.width,
          height: recordings.height,
        })
        .from(recordings)
        .where(and(...wheres))
        .orderBy(asc(recordings.startedAt))
        .all();
      // drizzle returns Dates for timestamp_ms columns; client expects epoch ms
      return {
        recordings: rows.map((r) => ({
          ...r,
          startedAt: r.startedAt.getTime(),
          endedAt: r.endedAt.getTime(),
        })),
      };
    },
  );

  // Issue a short-lived playback ticket for a specific recording
  app.post<{ Params: { id: string } }>(
    "/recordings/:id/ticket",
    { preHandler: app.requireAuth },
    async (req, reply) => {
      const r = db
        .select({ id: recordings.id })
        .from(recordings)
        .where(eq(recordings.id, req.params.id))
        .get();
      if (!r) return reply.code(404).send({ error: "not_found" });
      const t = signPlaybackTicket(
        { recordingId: req.params.id, userId: req.authUser!.id },
        jwtSecret,
      );
      return { ticket: t.token, expiresIn: t.expiresIn };
    },
  );

  // Range-aware MP4 file. Auth via Bearer header OR ?ticket=...
  app.get<{ Params: { id: string }; Querystring: { ticket?: string } }>(
    "/recordings/:id/file",
    async (req, reply) => {
      // Auth: prefer header, fall back to ticket
      let userId: string | null = null;
      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith("Bearer ")) {
        try {
          await req.jwtVerify();
          userId = req.user.id;
        } catch {
          return reply.code(401).send({ error: "unauthorized" });
        }
      } else if (req.query.ticket) {
        const decoded = verifyPlaybackTicket(req.query.ticket, jwtSecret);
        if (!decoded || decoded.recordingId !== req.params.id) {
          return reply.code(401).send({ error: "unauthorized" });
        }
        userId = decoded.userId;
      } else {
        return reply.code(401).send({ error: "unauthorized" });
      }
      void userId; // future: per-user audit

      const rec = db
        .select()
        .from(recordings)
        .where(eq(recordings.id, req.params.id))
        .get();
      if (!rec) return reply.code(404).send({ error: "not_found" });

      let s;
      try {
        s = await stat(rec.filePath);
      } catch {
        return reply.code(410).send({ error: "file_gone" });
      }

      const range = parseRangeHeader(req.headers.range, s.size);
      reply
        .header("Accept-Ranges", "bytes")
        .header("Content-Type", "video/mp4")
        .header("Cache-Control", "private, max-age=300");

      if (range) {
        const { start, end } = range;
        reply
          .code(206)
          .header("Content-Range", `bytes ${start}-${end}/${s.size}`)
          .header("Content-Length", String(end - start + 1));
        return reply.send(createReadStream(rec.filePath, { start, end }));
      }
      reply.header("Content-Length", String(s.size));
      return reply.send(createReadStream(rec.filePath));
    },
  );

  // Thumbnail jpg. Auth via Bearer header (no ticket; <img> can use auth header
  // through fetch+blob URL on the client, or we add a ticket variant later).
  app.get<{ Params: { id: string } }>(
    "/recordings/:id/thumbnail",
    { preHandler: app.requireAuth },
    async (req, reply) => {
      const rec = db
        .select()
        .from(recordings)
        .where(eq(recordings.id, req.params.id))
        .get();
      if (!rec) return reply.code(404).send({ error: "not_found" });
      const path = thumbs.thumbnailPath(rec.cameraId, rec.id);
      try {
        const fh = await open(path, "r");
        const stream = fh.createReadStream();
        reply
          .header("Content-Type", "image/jpeg")
          .header("Cache-Control", "private, max-age=3600");
        return reply.send(stream);
      } catch {
        return reply.code(404).send({ error: "no_thumbnail" });
      }
    },
  );
};
