-- Seed data for local development
-- Creates a demo organization and owner account
-- Password: "password123" (PBKDF2 hash placeholder - use the /api/auth/setup endpoint in dev)

INSERT OR IGNORE INTO organizations (id, name, slug, address, phone, timezone)
VALUES (
  'org_demo_0000000000000001',
  'The Demo Bar',
  'demo-bar',
  '123 Main St, Austin, TX 78701',
  '(512) 555-0100',
  'America/Chicago'
);

-- Note: Run `POST /api/auth/register` to create real users with properly hashed passwords
