import type { Context, Next } from 'hono';
import { verifyJWT } from '../utils/crypto';
import type { Env, UserSession } from '../types';

export async function authMiddleware(c: Context<{ Bindings: Env }>, next: Next) {
  const authHeader = c.req.header('Authorization');
  const cookieHeader = c.req.header('Cookie') ?? '';

  let token: string | undefined;

  if (authHeader?.startsWith('Bearer ')) {
    token = authHeader.slice(7);
  } else {
    // Try cookie
    const match = cookieHeader.match(/(?:^|;\s*)doorman_token=([^;]+)/);
    token = match?.[1];
  }

  if (!token) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const secret = c.env.JWT_SECRET;
  const payload = await verifyJWT(token, secret);
  if (!payload) {
    return c.json({ error: 'Invalid or expired token' }, 401);
  }

  c.set('user', payload as UserSession);
  await next();
}

/** Require a minimum role within the current org context. */
export function requireRole(...roles: string[]) {
  return async (c: Context<{ Bindings: Env; Variables: { user: UserSession } }>, next: Next) => {
    const user = c.get('user') as UserSession;
    const orgId = c.req.param('orgId') ?? c.req.header('X-Org-Id') ?? user.orgId;

    if (!orgId) return c.json({ error: 'Organization context required' }, 400);

    // Look up the member's role in this org
    const row = await c.env.DB.prepare(
      'SELECT role FROM org_members WHERE org_id = ? AND user_id = ?'
    )
      .bind(orgId, user.userId)
      .first<{ role: string }>();

    if (!row) return c.json({ error: 'Not a member of this organization' }, 403);
    if (!roles.includes(row.role)) {
      return c.json({ error: `Requires role: ${roles.join(' or ')}` }, 403);
    }

    c.set('orgRole', row.role);
    await next();
  };
}
