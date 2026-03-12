-- Organizations (tenants)
CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  address TEXT,
  phone TEXT,
  license_number TEXT,
  timezone TEXT NOT NULL DEFAULT 'America/Chicago',
  settings TEXT NOT NULL DEFAULT '{}',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Users (staff / admins)
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Organization memberships (multi-tenant user assignment)
CREATE TABLE IF NOT EXISTS org_members (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'staff' CHECK(role IN ('owner', 'admin', 'staff')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(org_id, user_id)
);

-- Patron scans / check-ins
CREATE TABLE IF NOT EXISTS patron_scans (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  scanned_by TEXT NOT NULL REFERENCES users(id),

  -- Raw AAMVA data (stored encrypted/hashed for privacy compliance)
  dl_number_hash TEXT NOT NULL,            -- SHA-256 of DL number for dedup
  dl_state TEXT NOT NULL,                   -- Issuing state/province
  dl_country TEXT NOT NULL DEFAULT 'USA',

  -- Identity fields
  first_name TEXT,
  last_name TEXT,
  middle_name TEXT,

  -- DOB stored as ISO date string for age calculation
  date_of_birth TEXT NOT NULL,
  expiration_date TEXT,

  -- Scan metadata
  age_at_scan INTEGER NOT NULL,
  is_of_age INTEGER NOT NULL DEFAULT 0,     -- 1 = 21+, 0 = underage
  is_expired INTEGER NOT NULL DEFAULT 0,

  -- Check-in/out tracking
  checked_in_at TEXT NOT NULL DEFAULT (datetime('now')),
  checked_out_at TEXT,
  status TEXT NOT NULL DEFAULT 'inside' CHECK(status IN ('inside', 'left', 'denied')),

  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Denied entry log (attempted underage / expired)
CREATE TABLE IF NOT EXISTS denied_entries (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  scanned_by TEXT NOT NULL REFERENCES users(id),
  dl_number_hash TEXT NOT NULL,
  dl_state TEXT NOT NULL,
  date_of_birth TEXT NOT NULL,
  age_at_scan INTEGER NOT NULL,
  denial_reason TEXT NOT NULL CHECK(denial_reason IN ('underage', 'expired', 'unreadable')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_patron_scans_org_status ON patron_scans(org_id, status);
CREATE INDEX IF NOT EXISTS idx_patron_scans_org_date ON patron_scans(org_id, checked_in_at);
CREATE INDEX IF NOT EXISTS idx_patron_scans_dl_hash ON patron_scans(dl_number_hash);
CREATE INDEX IF NOT EXISTS idx_org_members_user ON org_members(user_id);
CREATE INDEX IF NOT EXISTS idx_org_members_org ON org_members(org_id);
CREATE INDEX IF NOT EXISTS idx_denied_entries_org ON denied_entries(org_id, created_at);
