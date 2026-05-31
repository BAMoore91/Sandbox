-- ============================================================================
--  008 — Data retention (auto-purge old recordings & CDR per tenant)
-- ----------------------------------------------------------------------------
--  A background task in the API purges data older than these windows. 0 means
--  "keep forever" (no purge). Recording purge deletes both the file on the
--  shared monitor volume and the catalog row; CDR purge deletes old call rows.
-- ============================================================================
ALTER TABLE tenants
    ADD COLUMN recording_retention_days integer NOT NULL DEFAULT 0,
    ADD COLUMN cdr_retention_days       integer NOT NULL DEFAULT 0;

-- Records each retention sweep for visibility/audit in the portal.
CREATE TABLE retention_runs (
    id                 BIGSERIAL PRIMARY KEY,
    tenant_id          integer REFERENCES tenants(id) ON DELETE CASCADE,
    started_at         timestamptz NOT NULL DEFAULT now(),
    finished_at        timestamptz,
    recordings_deleted integer NOT NULL DEFAULT 0,
    cdr_deleted        integer NOT NULL DEFAULT 0,
    files_deleted      integer NOT NULL DEFAULT 0,
    files_missing      integer NOT NULL DEFAULT 0,
    error              text
);
CREATE INDEX idx_retention_runs_tenant ON retention_runs (tenant_id, started_at DESC);

-- Demo: keep the demo tenant's recordings 90 days, CDR 365 days.
UPDATE tenants SET recording_retention_days = 90, cdr_retention_days = 365
 WHERE slug = 'acme';
