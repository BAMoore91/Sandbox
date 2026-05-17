import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { cameras } from "../db/schema.js";
import type { Go2rtcService } from "../streaming/go2rtc.js";
import { probeStream } from "../cameras/probe.js";
import { discoverOnvifDevices } from "../cameras/discovery.js";
import { streamName, subStreamName } from "../streaming/go2rtc.js";

const RtspUrl = z.string().regex(/^rtsps?:\/\//i, "must start with rtsp://");

const CreateCameraBody = z.object({
  name: z.string().min(1).max(80),
  rtspUrl: RtspUrl,
  subRtspUrl: RtspUrl.optional().nullable(),
  onvifUrl: z.string().url().optional().nullable(),
  username: z.string().max(80).optional().nullable(),
  password: z.string().max(200).optional().nullable(),
  enabled: z.boolean().optional(),
  retentionDays: z.number().int().min(1).max(3650).optional().nullable(),
});

const UpdateCameraBody = CreateCameraBody.partial();

const ProbeBody = z.object({
  url: RtspUrl,
});

interface Opts {
  db: Db;
  go2rtc: Go2rtcService;
}

export const cameraRoutes: FastifyPluginAsync<Opts> = async (
  app,
  { db, go2rtc },
) => {
  app.get("/", { preHandler: app.requireAuth }, async () => {
    const rows = db.select().from(cameras).all();
    return {
      cameras: rows.map((c) => ({
        ...c,
        // Never leak the stored credential blob
        passwordEnc: undefined,
        streamNames: {
          main: streamName(c.id),
          sub: c.subRtspUrl ? subStreamName(c.id) : null,
        },
      })),
    };
  });

  app.post(
    "/",
    { preHandler: app.requireRole("admin") },
    async (req, reply) => {
      const body = CreateCameraBody.parse(req.body);
      const id = randomUUID();
      const now = new Date();
      db.insert(cameras)
        .values({
          id,
          name: body.name,
          rtspUrl: body.rtspUrl,
          subRtspUrl: body.subRtspUrl ?? null,
          onvifUrl: body.onvifUrl ?? null,
          username: body.username ?? null,
          // Phase-1 stub: store plaintext in passwordEnc until encryption lands.
          // Marked encrypted=false in metadata column via NULL passwordEnc when
          // no password provided.
          passwordEnc: body.password ?? null,
          enabled: body.enabled ?? true,
          aiEnabled: false,
          retentionDays: body.retentionDays ?? null,
          createdAt: now,
          updatedAt: now,
        })
        .run();
      await go2rtc.reload();
      const created = db.select().from(cameras).where(eq(cameras.id, id)).get();
      return reply
        .code(201)
        .send({ camera: { ...created, passwordEnc: undefined } });
    },
  );

  app.get<{ Params: { id: string } }>(
    "/:id",
    { preHandler: app.requireAuth },
    async (req, reply) => {
      const c = db.select().from(cameras).where(eq(cameras.id, req.params.id)).get();
      if (!c) return reply.code(404).send({ error: "not_found" });
      return { camera: { ...c, passwordEnc: undefined } };
    },
  );

  app.patch<{ Params: { id: string } }>(
    "/:id",
    { preHandler: app.requireRole("admin") },
    async (req, reply) => {
      const body = UpdateCameraBody.parse(req.body);
      const target = db
        .select()
        .from(cameras)
        .where(eq(cameras.id, req.params.id))
        .get();
      if (!target) return reply.code(404).send({ error: "not_found" });

      const next: Partial<typeof target> = { updatedAt: new Date() };
      if (body.name !== undefined) next.name = body.name;
      if (body.rtspUrl !== undefined) next.rtspUrl = body.rtspUrl;
      if (body.subRtspUrl !== undefined)
        next.subRtspUrl = body.subRtspUrl ?? null;
      if (body.onvifUrl !== undefined) next.onvifUrl = body.onvifUrl ?? null;
      if (body.username !== undefined) next.username = body.username ?? null;
      if (body.password !== undefined) next.passwordEnc = body.password ?? null;
      if (body.enabled !== undefined) next.enabled = body.enabled;
      if (body.retentionDays !== undefined)
        next.retentionDays = body.retentionDays ?? null;

      db.update(cameras).set(next).where(eq(cameras.id, req.params.id)).run();
      await go2rtc.reload();
      const updated = db
        .select()
        .from(cameras)
        .where(eq(cameras.id, req.params.id))
        .get();
      return { camera: { ...updated, passwordEnc: undefined } };
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/:id",
    { preHandler: app.requireRole("admin") },
    async (req, reply) => {
      const r = db.delete(cameras).where(eq(cameras.id, req.params.id)).run();
      if (r.changes === 0) return reply.code(404).send({ error: "not_found" });
      await go2rtc.reload();
      return { ok: true };
    },
  );

  app.post(
    "/probe",
    { preHandler: app.requireRole("admin") },
    async (req) => {
      const body = ProbeBody.parse(req.body);
      const result = await probeStream(body.url);
      return result;
    },
  );

  app.post(
    "/discover",
    { preHandler: app.requireRole("admin") },
    async () => {
      const devices = await discoverOnvifDevices();
      return { devices };
    },
  );

  app.get<{ Params: { id: string } }>(
    "/:id/stream-info",
    { preHandler: app.requireAuth },
    async (req, reply) => {
      const c = db.select().from(cameras).where(eq(cameras.id, req.params.id)).get();
      if (!c) return reply.code(404).send({ error: "not_found" });
      const info = await go2rtc.getStreamInfo(c.id);
      return { info, streamName: streamName(c.id) };
    },
  );
};
