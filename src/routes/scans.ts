import { Hono } from 'hono';
import { authMiddleware, requireRole } from '../middleware/auth';
import { parseAAMVA } from '../utils/aamva';
import { sha256 } from '../utils/crypto';
import type { Env, UserSession, PatronScanRow } from '../types';

const scans = new Hono<{ Bindings: Env; Variables: { user: UserSession; orgRole: string } }>();

scans.use('*', authMiddleware);

// ── Scan a barcode (check-in) ─────────────────────────────────────────────────
// POST /api/orgs/:orgId/scans
// body: { barcodeData: string }

scans.post('/:orgId/scans', requireRole('owner', 'admin', 'staff'), async (c) => {
  const { orgId } = c.req.param();
  const user = c.get('user');
  const body = await c.req.json<{ barcodeData: string }>();

  if (!body.barcodeData) {
    return c.json({ error: 'barcodeData is required' }, 400);
  }

  // Parse AAMVA
  const result = parseAAMVA(body.barcodeData);
  if (!result.success || !result.data) {
    // Log as unreadable denial
    await recordDenial(c.env, orgId, user.userId, null, 'unreadable');
    return c.json({ error: result.error ?? 'Failed to parse barcode', action: 'denied' }, 422);
  }

  const data = result.data;
  const dlHash = await sha256(`${data.dlNumber}:${data.dlState}`);

  // Check if expired
  if (data.isExpired) {
    await recordDenial(c.env, orgId, user.userId, { dlHash, dlState: data.dlState, dob: data.dateOfBirth, age: data.age }, 'expired');
    return c.json({
      action: 'denied',
      reason: 'expired',
      message: 'ID is expired',
      age: data.age,
      firstName: data.firstName,
      lastName: data.lastName,
      dateOfBirth: data.dateOfBirth,
      expirationDate: data.expirationDate,
    });
  }

  // Check age
  if (!data.isOfAge) {
    await recordDenial(c.env, orgId, user.userId, { dlHash, dlState: data.dlState, dob: data.dateOfBirth, age: data.age }, 'underage');
    return c.json({
      action: 'denied',
      reason: 'underage',
      message: `Patron is ${data.age} years old – under 21`,
      age: data.age,
      firstName: data.firstName,
      lastName: data.lastName,
      dateOfBirth: data.dateOfBirth,
    });
  }

  // Check if patron is already checked in (prevent duplicate check-ins)
  const alreadyIn = await c.env.DB.prepare(
    `SELECT id FROM patron_scans
     WHERE org_id = ? AND dl_number_hash = ? AND status = 'inside'
     LIMIT 1`
  )
    .bind(orgId, dlHash)
    .first<{ id: string }>();

  if (alreadyIn) {
    return c.json({
      action: 'already_inside',
      message: 'Patron is already checked in',
      scanId: alreadyIn.id,
      age: data.age,
      firstName: data.firstName,
      lastName: data.lastName,
    });
  }

  // Record check-in
  const scanId = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO patron_scans
       (id, org_id, scanned_by, dl_number_hash, dl_state, dl_country,
        first_name, last_name, middle_name,
        date_of_birth, expiration_date,
        age_at_scan, is_of_age, is_expired, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, 'inside')`
  )
    .bind(
      scanId,
      orgId,
      user.userId,
      dlHash,
      data.dlState,
      data.dlCountry,
      data.firstName || null,
      data.lastName || null,
      data.middleName ?? null,
      data.dateOfBirth,
      data.expirationDate ?? null,
      data.age
    )
    .run();

  // Current count
  const countRow = await c.env.DB.prepare(
    `SELECT COUNT(*) AS cnt FROM patron_scans WHERE org_id = ? AND status = 'inside'`
  )
    .bind(orgId)
    .first<{ cnt: number }>();

  return c.json({
    action: 'admitted',
    scanId,
    age: data.age,
    firstName: data.firstName,
    lastName: data.lastName,
    dateOfBirth: data.dateOfBirth,
    dlState: data.dlState,
    currentCount: countRow?.cnt ?? 0,
  });
});

// ── Check out a patron ────────────────────────────────────────────────────────
// POST /api/orgs/:orgId/scans/:scanId/checkout

scans.post('/:orgId/scans/:scanId/checkout', requireRole('owner', 'admin', 'staff'), async (c) => {
  const { orgId, scanId } = c.req.param();

  const scan = await c.env.DB.prepare(
    `SELECT id, status FROM patron_scans WHERE id = ? AND org_id = ?`
  )
    .bind(scanId, orgId)
    .first<{ id: string; status: string }>();

  if (!scan) return c.json({ error: 'Scan not found' }, 404);
  if (scan.status !== 'inside') return c.json({ error: 'Patron is not checked in' }, 400);

  await c.env.DB.prepare(
    `UPDATE patron_scans
     SET status = 'left', checked_out_at = datetime('now')
     WHERE id = ?`
  )
    .bind(scanId)
    .run();

  const countRow = await c.env.DB.prepare(
    `SELECT COUNT(*) AS cnt FROM patron_scans WHERE org_id = ? AND status = 'inside'`
  )
    .bind(orgId)
    .first<{ cnt: number }>();

  return c.json({ message: 'Checked out', currentCount: countRow?.cnt ?? 0 });
});

// ── Bulk checkout (end of night / close) ─────────────────────────────────────
// POST /api/orgs/:orgId/scans/checkout-all

scans.post('/:orgId/scans/checkout-all', requireRole('owner', 'admin'), async (c) => {
  const { orgId } = c.req.param();

  await c.env.DB.prepare(
    `UPDATE patron_scans
     SET status = 'left', checked_out_at = datetime('now')
     WHERE org_id = ? AND status = 'inside'`
  )
    .bind(orgId)
    .run();

  return c.json({ message: 'All patrons checked out' });
});

// ── Get current patron count ──────────────────────────────────────────────────
// GET /api/orgs/:orgId/count

scans.get('/:orgId/count', requireRole('owner', 'admin', 'staff'), async (c) => {
  const { orgId } = c.req.param();

  const row = await c.env.DB.prepare(
    `SELECT COUNT(*) AS cnt FROM patron_scans WHERE org_id = ? AND status = 'inside'`
  )
    .bind(orgId)
    .first<{ cnt: number }>();

  return c.json({ count: row?.cnt ?? 0 });
});

// ── List patrons currently inside ─────────────────────────────────────────────
// GET /api/orgs/:orgId/scans?status=inside&date=2024-07-01

scans.get('/:orgId/scans', requireRole('owner', 'admin', 'staff'), async (c) => {
  const { orgId } = c.req.param();
  const status = c.req.query('status') ?? 'inside';
  const date = c.req.query('date'); // ISO date filter
  const page = parseInt(c.req.query('page') ?? '1', 10);
  const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10), 200);
  const offset = (page - 1) * limit;

  let query = `
    SELECT ps.*, u.first_name AS staff_first, u.last_name AS staff_last
    FROM patron_scans ps
    JOIN users u ON u.id = ps.scanned_by
    WHERE ps.org_id = ?`;
  const params: unknown[] = [orgId];

  if (status !== 'all') {
    query += ' AND ps.status = ?';
    params.push(status);
  }
  if (date) {
    query += ' AND date(ps.checked_in_at) = ?';
    params.push(date);
  }

  query += ' ORDER BY ps.checked_in_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const rows = await c.env.DB.prepare(query)
    .bind(...params)
    .all<PatronScanRow>();

  // Total count
  let countQuery = `SELECT COUNT(*) AS cnt FROM patron_scans WHERE org_id = ?`;
  const countParams: unknown[] = [orgId];
  if (status !== 'all') { countQuery += ' AND status = ?'; countParams.push(status); }
  if (date) { countQuery += ' AND date(checked_in_at) = ?'; countParams.push(date); }

  const countRow = await c.env.DB.prepare(countQuery)
    .bind(...countParams)
    .first<{ cnt: number }>();

  return c.json({
    scans: rows.results ?? [],
    total: countRow?.cnt ?? 0,
    page,
    limit,
  });
});

// ── Dashboard stats ───────────────────────────────────────────────────────────
// GET /api/orgs/:orgId/stats

scans.get('/:orgId/stats', requireRole('owner', 'admin', 'staff'), async (c) => {
  const { orgId } = c.req.param();
  const today = new Date().toISOString().slice(0, 10);

  const [current, todayAdmitted, todayDenied, hourly] = await Promise.all([
    c.env.DB.prepare(
      `SELECT COUNT(*) AS cnt FROM patron_scans WHERE org_id = ? AND status = 'inside'`
    ).bind(orgId).first<{ cnt: number }>(),

    c.env.DB.prepare(
      `SELECT COUNT(*) AS cnt FROM patron_scans WHERE org_id = ? AND date(checked_in_at) = ?`
    ).bind(orgId, today).first<{ cnt: number }>(),

    c.env.DB.prepare(
      `SELECT COUNT(*) AS cnt FROM denied_entries WHERE org_id = ? AND date(created_at) = ?`
    ).bind(orgId, today).first<{ cnt: number }>(),

    c.env.DB.prepare(
      `SELECT strftime('%H', checked_in_at) AS hour, COUNT(*) AS cnt
       FROM patron_scans
       WHERE org_id = ? AND date(checked_in_at) = ?
       GROUP BY hour ORDER BY hour`
    ).bind(orgId, today).all<{ hour: string; cnt: number }>(),
  ]);

  return c.json({
    currentCount: current?.cnt ?? 0,
    todayAdmitted: todayAdmitted?.cnt ?? 0,
    todayDenied: todayDenied?.cnt ?? 0,
    hourlyBreakdown: hourly.results ?? [],
  });
});

// ── Denied entries log ────────────────────────────────────────────────────────
// GET /api/orgs/:orgId/denied

scans.get('/:orgId/denied', requireRole('owner', 'admin'), async (c) => {
  const { orgId } = c.req.param();
  const date = c.req.query('date');

  let query = `
    SELECT de.*, u.first_name AS staff_first, u.last_name AS staff_last
    FROM denied_entries de
    JOIN users u ON u.id = de.scanned_by
    WHERE de.org_id = ?`;
  const params: unknown[] = [orgId];

  if (date) { query += ' AND date(de.created_at) = ?'; params.push(date); }
  query += ' ORDER BY de.created_at DESC LIMIT 100';

  const rows = await c.env.DB.prepare(query).bind(...params).all();
  return c.json({ denied: rows.results ?? [] });
});

// ─── helpers ──────────────────────────────────────────────────────────────────

async function recordDenial(
  env: Env,
  orgId: string,
  userId: string,
  info: { dlHash: string; dlState: string; dob: string; age: number } | null,
  reason: 'underage' | 'expired' | 'unreadable'
) {
  await env.DB.prepare(
    `INSERT INTO denied_entries (id, org_id, scanned_by, dl_number_hash, dl_state, date_of_birth, age_at_scan, denial_reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      crypto.randomUUID(),
      orgId,
      userId,
      info?.dlHash ?? 'unreadable',
      info?.dlState ?? 'UNK',
      info?.dob ?? '1900-01-01',
      info?.age ?? 0,
      reason
    )
    .run();
}

export default scans;
