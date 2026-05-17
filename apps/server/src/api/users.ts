import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { users } from "../db/schema.js";

const UpdateRoleBody = z.object({
  role: z.enum(["admin", "viewer"]),
});

interface Opts {
  db: Db;
}

export const userRoutes: FastifyPluginAsync<Opts> = async (app, { db }) => {
  app.get(
    "/",
    { preHandler: app.requireRole("admin") },
    async () => {
      const all = db
        .select({
          id: users.id,
          email: users.email,
          displayName: users.displayName,
          role: users.role,
          disabled: users.disabled,
          createdAt: users.createdAt,
          lastLoginAt: users.lastLoginAt,
        })
        .from(users)
        .all();
      return { users: all };
    },
  );

  app.patch<{ Params: { id: string } }>(
    "/:id/role",
    { preHandler: app.requireRole("admin") },
    async (req, reply) => {
      const body = UpdateRoleBody.parse(req.body);
      const target = db
        .select()
        .from(users)
        .where(eq(users.id, req.params.id))
        .get();
      if (!target) return reply.code(404).send({ error: "not_found" });
      db.update(users)
        .set({ role: body.role })
        .where(eq(users.id, req.params.id))
        .run();
      return { ok: true };
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/:id",
    { preHandler: app.requireRole("admin") },
    async (req, reply) => {
      if (req.authUser!.id === req.params.id) {
        return reply.code(400).send({ error: "cannot_delete_self" });
      }
      const r = db.delete(users).where(eq(users.id, req.params.id)).run();
      if (r.changes === 0) return reply.code(404).send({ error: "not_found" });
      return { ok: true };
    },
  );
};
