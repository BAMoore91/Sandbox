import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { users } from "../db/schema.js";
import { hashPassword, verifyPassword } from "../auth/passwords.js";

const LoginBody = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const RegisterBody = z.object({
  email: z.string().email(),
  displayName: z.string().min(1).max(80),
  password: z.string().min(8).max(200),
});

interface Opts {
  db: Db;
}

export const authRoutes: FastifyPluginAsync<Opts> = async (app, { db }) => {
  // Bootstrap: first user becomes admin. After that, registration is
  // admin-only (mounted under requireRole('admin') elsewhere).
  app.post("/register", async (req, reply) => {
    const body = RegisterBody.parse(req.body);
    const existingCount = db.$count(users);
    const count = await existingCount;

    if (count > 0) {
      // Require admin auth after first user exists
      try {
        await req.jwtVerify();
      } catch {
        return reply.code(401).send({ error: "unauthorized" });
      }
      if (req.user.role !== "admin") {
        return reply.code(403).send({ error: "forbidden" });
      }
    }

    const existing = db
      .select()
      .from(users)
      .where(eq(users.email, body.email))
      .get();
    if (existing) {
      return reply.code(409).send({ error: "email_in_use" });
    }

    const role = count === 0 ? "admin" : "viewer";
    const id = randomUUID();
    const passwordHash = await hashPassword(body.password);

    db.insert(users)
      .values({
        id,
        email: body.email,
        displayName: body.displayName,
        passwordHash,
        role,
      })
      .run();

    const token = await reply.jwtSign({ id, email: body.email, role });
    return { token, user: { id, email: body.email, role, displayName: body.displayName } };
  });

  app.post("/login", async (req, reply) => {
    const body = LoginBody.parse(req.body);
    const user = db
      .select()
      .from(users)
      .where(eq(users.email, body.email))
      .get();
    if (!user || user.disabled) {
      return reply.code(401).send({ error: "invalid_credentials" });
    }
    const ok = await verifyPassword(body.password, user.passwordHash);
    if (!ok) {
      return reply.code(401).send({ error: "invalid_credentials" });
    }
    db.update(users)
      .set({ lastLoginAt: new Date() })
      .where(eq(users.id, user.id))
      .run();
    const token = await reply.jwtSign({
      id: user.id,
      email: user.email,
      role: user.role,
    });
    return {
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        displayName: user.displayName,
      },
    };
  });

  app.get("/me", { preHandler: app.requireAuth }, async (req) => {
    const u = db
      .select()
      .from(users)
      .where(eq(users.id, req.authUser!.id))
      .get();
    if (!u) return { user: null };
    return {
      user: {
        id: u.id,
        email: u.email,
        role: u.role,
        displayName: u.displayName,
      },
    };
  });

  app.get("/bootstrap-status", async () => {
    const c = await db.$count(users);
    return { needsBootstrap: c === 0 };
  });
};
