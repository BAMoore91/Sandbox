import fp from "fastify-plugin";
import fastifyJwt from "@fastify/jwt";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import type { Role } from "./types.js";

interface AuthOptions {
  jwtSecret: string;
}

const authPlugin: FastifyPluginAsync<AuthOptions> = async (app, opts) => {
  await app.register(fastifyJwt, {
    secret: opts.jwtSecret,
    sign: { expiresIn: "7d" },
  });

  app.decorate(
    "requireAuth",
    async (req: FastifyRequest, reply: FastifyReply) => {
      try {
        await req.jwtVerify();
        req.authUser = req.user;
      } catch {
        reply.code(401).send({ error: "unauthorized" });
      }
    },
  );

  app.decorate("requireRole", (role: Role) => {
    return async (req: FastifyRequest, reply: FastifyReply) => {
      try {
        await req.jwtVerify();
        req.authUser = req.user;
      } catch {
        return reply.code(401).send({ error: "unauthorized" });
      }
      if (role === "admin" && req.authUser.role !== "admin") {
        return reply.code(403).send({ error: "forbidden" });
      }
    };
  });
};

declare module "fastify" {
  interface FastifyInstance {
    requireAuth: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireRole: (
      role: Role,
    ) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export default fp(authPlugin, { name: "auth" });
