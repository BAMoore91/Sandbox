import { Hono } from 'hono';
import { authMiddleware, requireRole } from '../middleware/auth';
import type { Env, UserSession, OrgRow } from '../types';

const orgs = new Hono<{ Bindings: Env; Variables: { user: UserSession; orgRole: string } }>();

// All org routes require auth
orgs.use('*', authMiddleware);

// ── List orgs for the current user ───────────────────────────────────────────

orgs.get('/', async (c) => {
  const user = c.get('user');
  const rows = await c.env.DB.prepare(
    `SELECT o.*, om.role
     FROM organizations o
     JOIN org_members om ON om.org_id = o.id
     WHERE om.user_id = ? AND o.active = 1
     ORDER BY o.name`
  )
    .bind(user.userId)
    .all<OrgRow & { role: string }>();

  return c.json({ orgs: rows.results ?? [] });
});

// ── Create organization ───────────────────────────────────────────────────────

orgs.post('/', async (c) => {
  const user = c.get('user');
  const body = await c.req.json<{
    name: string;
    slug?: string;
    address?: string;
    phone?: string;
    licenseNumber?: string;
    timezone?: string;
  }>();

  if (!body.name) return c.json({ error: 'name is required' }, 400);

  const slug =
    body.slug ??
    body.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

  // Check slug uniqueness
  const existing = await c.env.DB.prepare('SELECT id FROM organizations WHERE slug = ?')
    .bind(slug)
    .first();
  if (existing) return c.json({ error: 'Slug already taken. Choose a different name or provide a custom slug.' }, 409);

  const orgId = crypto.randomUUID();
  const memberId = crypto.randomUUID();

  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO organizations (id, name, slug, address, phone, license_number, timezone)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      orgId,
      body.name.trim(),
      slug,
      body.address ?? null,
      body.phone ?? null,
      body.licenseNumber ?? null,
      body.timezone ?? 'America/Chicago'
    ),
    // Make the creator the owner
    c.env.DB.prepare(
      `INSERT INTO org_members (id, org_id, user_id, role) VALUES (?, ?, ?, 'owner')`
    ).bind(memberId, orgId, user.userId),
  ]);

  const org = await c.env.DB.prepare('SELECT * FROM organizations WHERE id = ?')
    .bind(orgId)
    .first<OrgRow>();

  return c.json({ org, role: 'owner' }, 201);
});

// ── Get single org ────────────────────────────────────────────────────────────

orgs.get('/:orgId', authMiddleware, async (c) => {
  const user = c.get('user');
  const { orgId } = c.req.param();

  const row = await c.env.DB.prepare(
    `SELECT o.*, om.role FROM organizations o
     JOIN org_members om ON om.org_id = o.id
     WHERE o.id = ? AND om.user_id = ? AND o.active = 1`
  )
    .bind(orgId, user.userId)
    .first<OrgRow & { role: string }>();

  if (!row) return c.json({ error: 'Organization not found' }, 404);
  return c.json({ org: row });
});

// ── Update org (admin/owner only) ─────────────────────────────────────────────

orgs.patch('/:orgId', requireRole('owner', 'admin'), async (c) => {
  const { orgId } = c.req.param();
  const body = await c.req.json<Partial<{
    name: string;
    address: string;
    phone: string;
    licenseNumber: string;
    timezone: string;
    settings: Record<string, unknown>;
  }>>();

  const updates: string[] = [];
  const vals: unknown[] = [];

  if (body.name) { updates.push('name = ?'); vals.push(body.name.trim()); }
  if (body.address !== undefined) { updates.push('address = ?'); vals.push(body.address); }
  if (body.phone !== undefined) { updates.push('phone = ?'); vals.push(body.phone); }
  if (body.licenseNumber !== undefined) { updates.push('license_number = ?'); vals.push(body.licenseNumber); }
  if (body.timezone) { updates.push('timezone = ?'); vals.push(body.timezone); }
  if (body.settings) { updates.push('settings = ?'); vals.push(JSON.stringify(body.settings)); }

  if (updates.length === 0) return c.json({ error: 'Nothing to update' }, 400);

  updates.push("updated_at = datetime('now')");
  vals.push(orgId);

  await c.env.DB.prepare(
    `UPDATE organizations SET ${updates.join(', ')} WHERE id = ?`
  )
    .bind(...vals)
    .run();

  const org = await c.env.DB.prepare('SELECT * FROM organizations WHERE id = ?')
    .bind(orgId)
    .first<OrgRow>();

  return c.json({ org });
});

// ── List org members ──────────────────────────────────────────────────────────

orgs.get('/:orgId/members', requireRole('owner', 'admin', 'staff'), async (c) => {
  const { orgId } = c.req.param();
  const rows = await c.env.DB.prepare(
    `SELECT u.id, u.email, u.first_name, u.last_name, u.active, om.role, om.created_at
     FROM users u
     JOIN org_members om ON om.user_id = u.id
     WHERE om.org_id = ?
     ORDER BY om.role, u.last_name`
  )
    .bind(orgId)
    .all();

  return c.json({ members: rows.results ?? [] });
});

// ── Invite / add member (owner/admin only) ────────────────────────────────────

orgs.post('/:orgId/members', requireRole('owner', 'admin'), async (c) => {
  const { orgId } = c.req.param();
  const body = await c.req.json<{ email: string; role?: string }>();

  if (!body.email) return c.json({ error: 'email is required' }, 400);
  const role = body.role ?? 'staff';
  if (!['owner', 'admin', 'staff'].includes(role)) {
    return c.json({ error: 'role must be owner, admin, or staff' }, 400);
  }

  // Only owners can assign other owners
  const caller = c.get('user');
  if (role === 'owner') {
    const callerRole = await c.env.DB.prepare(
      'SELECT role FROM org_members WHERE org_id = ? AND user_id = ?'
    )
      .bind(orgId, caller.userId)
      .first<{ role: string }>();
    if (callerRole?.role !== 'owner') {
      return c.json({ error: 'Only owners can assign the owner role' }, 403);
    }
  }

  const user = await c.env.DB.prepare('SELECT id FROM users WHERE email = ? AND active = 1')
    .bind(body.email.toLowerCase())
    .first<{ id: string }>();

  if (!user) return c.json({ error: 'User not found. Ask them to register first.' }, 404);

  // Check if already a member
  const existing = await c.env.DB.prepare(
    'SELECT id FROM org_members WHERE org_id = ? AND user_id = ?'
  )
    .bind(orgId, user.id)
    .first();

  if (existing) return c.json({ error: 'User is already a member' }, 409);

  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO org_members (id, org_id, user_id, role) VALUES (?, ?, ?, ?)`
  )
    .bind(id, orgId, user.id, role)
    .run();

  return c.json({ message: 'Member added', memberId: id }, 201);
});

// ── Update member role ────────────────────────────────────────────────────────

orgs.patch('/:orgId/members/:userId', requireRole('owner', 'admin'), async (c) => {
  const { orgId, userId } = c.req.param();
  const body = await c.req.json<{ role: string }>();
  const role = body.role;

  if (!['owner', 'admin', 'staff'].includes(role)) {
    return c.json({ error: 'role must be owner, admin, or staff' }, 400);
  }

  await c.env.DB.prepare(
    'UPDATE org_members SET role = ? WHERE org_id = ? AND user_id = ?'
  )
    .bind(role, orgId, userId)
    .run();

  return c.json({ message: 'Role updated' });
});

// ── Remove member ─────────────────────────────────────────────────────────────

orgs.delete('/:orgId/members/:userId', requireRole('owner', 'admin'), async (c) => {
  const { orgId, userId } = c.req.param();

  await c.env.DB.prepare(
    'DELETE FROM org_members WHERE org_id = ? AND user_id = ?'
  )
    .bind(orgId, userId)
    .run();

  return c.json({ message: 'Member removed' });
});

export default orgs;
