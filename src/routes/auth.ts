import { Hono } from 'hono';
import { hashPassword, verifyPassword, createJWT } from '../utils/crypto';
import type { Env, UserRow } from '../types';

const auth = new Hono<{ Bindings: Env }>();

// ── Register ──────────────────────────────────────────────────────────────────

auth.post('/register', async (c) => {
  const body = await c.req.json<{
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    inviteCode?: string;
  }>();

  const { email, password, firstName, lastName } = body;
  if (!email || !password || !firstName || !lastName) {
    return c.json({ error: 'email, password, firstName, lastName are required' }, 400);
  }
  if (password.length < 8) {
    return c.json({ error: 'Password must be at least 8 characters' }, 400);
  }

  // Check duplicate
  const existing = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?')
    .bind(email.toLowerCase())
    .first();
  if (existing) return c.json({ error: 'Email already in use' }, 409);

  const passwordHash = await hashPassword(password);
  const id = crypto.randomUUID();

  await c.env.DB.prepare(
    'INSERT INTO users (id, email, password_hash, first_name, last_name) VALUES (?, ?, ?, ?, ?)'
  )
    .bind(id, email.toLowerCase(), passwordHash, firstName.trim(), lastName.trim())
    .run();

  const token = await createJWT(
    { userId: id, email: email.toLowerCase(), firstName, lastName },
    c.env.JWT_SECRET
  );

  return c.json(
    { token, user: { id, email: email.toLowerCase(), firstName, lastName } },
    201
  );
});

// ── Login ─────────────────────────────────────────────────────────────────────

auth.post('/login', async (c) => {
  const body = await c.req.json<{ email: string; password: string; orgSlug?: string }>();
  const { email, password } = body;

  if (!email || !password) {
    return c.json({ error: 'email and password are required' }, 400);
  }

  const user = await c.env.DB.prepare('SELECT * FROM users WHERE email = ? AND active = 1')
    .bind(email.toLowerCase())
    .first<UserRow>();

  if (!user) return c.json({ error: 'Invalid credentials' }, 401);

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) return c.json({ error: 'Invalid credentials' }, 401);

  // Fetch user's org memberships
  const memberships = await c.env.DB.prepare(
    `SELECT om.org_id, om.role, o.name, o.slug
     FROM org_members om
     JOIN organizations o ON o.id = om.org_id
     WHERE om.user_id = ? AND o.active = 1`
  )
    .bind(user.id)
    .all<{ org_id: string; role: string; name: string; slug: string }>();

  const orgs = memberships.results ?? [];

  // Pick default org (first one, or match slug if provided)
  let defaultOrg = orgs[0];
  if (body.orgSlug) {
    defaultOrg = orgs.find((o) => o.slug === body.orgSlug) ?? defaultOrg;
  }

  const token = await createJWT(
    {
      userId: user.id,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
      orgId: defaultOrg?.org_id,
    },
    c.env.JWT_SECRET
  );

  return c.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
    },
    orgs,
    defaultOrgId: defaultOrg?.org_id,
  });
});

// ── Change password ───────────────────────────────────────────────────────────

auth.post('/change-password', async (c) => {
  const authHeader = c.req.header('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return c.json({ error: 'Unauthorized' }, 401);

  const body = await c.req.json<{
    currentPassword: string;
    newPassword: string;
  }>();

  if (!body.currentPassword || !body.newPassword) {
    return c.json({ error: 'currentPassword and newPassword are required' }, 400);
  }
  if (body.newPassword.length < 8) {
    return c.json({ error: 'New password must be at least 8 characters' }, 400);
  }

  // We need to verify the old password; import verifyJWT here to get userId
  const { verifyJWT } = await import('../utils/crypto');
  const payload = await verifyJWT(authHeader.slice(7), c.env.JWT_SECRET);
  if (!payload) return c.json({ error: 'Unauthorized' }, 401);

  const user = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?')
    .bind(payload.userId as string)
    .first<UserRow>();
  if (!user) return c.json({ error: 'User not found' }, 404);

  const valid = await verifyPassword(body.currentPassword, user.password_hash);
  if (!valid) return c.json({ error: 'Current password is incorrect' }, 401);

  const newHash = await hashPassword(body.newPassword);
  await c.env.DB.prepare('UPDATE users SET password_hash = ?, updated_at = datetime(\'now\') WHERE id = ?')
    .bind(newHash, user.id)
    .run();

  return c.json({ message: 'Password updated successfully' });
});

export default auth;
