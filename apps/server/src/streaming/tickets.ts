import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Short-lived signed tickets for the live-stream WebSocket.
 *
 * The browser can't set Authorization headers on a WebSocket upgrade,
 * and putting the long-lived user JWT in the URL is a leak risk. So the
 * client posts to `/api/streams/:id/ticket` with its user JWT, gets a
 * 60-second ticket scoped to a single camera + stream kind, and passes
 * that as `?ticket=` on the WS URL.
 *
 * Format: base64url(payload).base64url(hmacSha256(payload, secret))
 * Payload is JSON: { cameraId, userId, kind, exp }
 *
 * We don't use the @fastify/jwt instance directly so the ticket payload
 * type stays separate from the user JWT payload.
 */

export interface StreamTicket {
  cameraId: string;
  userId: string;
  kind: "main" | "sub";
  /** Expiry epoch seconds */
  exp: number;
}

function b64urlEncode(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function b64urlDecode(str: string): Buffer {
  const pad = str.length % 4 === 0 ? "" : "=".repeat(4 - (str.length % 4));
  return Buffer.from(
    str.replace(/-/g, "+").replace(/_/g, "/") + pad,
    "base64",
  );
}

function sign(payload: string, secret: string): string {
  return b64urlEncode(createHmac("sha256", secret).update(payload).digest());
}

export function signStreamTicket(
  payload: Omit<StreamTicket, "exp">,
  secret: string,
  ttlSeconds = 60,
): { token: string; expiresIn: number } {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const full: StreamTicket = { ...payload, exp };
  const body = b64urlEncode(Buffer.from(JSON.stringify(full), "utf8"));
  const sig = sign(body, secret);
  return { token: `${body}.${sig}`, expiresIn: ttlSeconds };
}

export function verifyStreamTicket(
  token: string,
  secret: string,
): StreamTicket | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts as [string, string];
  const expected = sign(body, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const decoded = JSON.parse(
      b64urlDecode(body).toString("utf8"),
    ) as StreamTicket;
    if (!decoded.cameraId || !decoded.userId || !decoded.kind || !decoded.exp) {
      return null;
    }
    if (decoded.exp < Math.floor(Date.now() / 1000)) return null;
    if (decoded.kind !== "main" && decoded.kind !== "sub") return null;
    return decoded;
  } catch {
    return null;
  }
}
