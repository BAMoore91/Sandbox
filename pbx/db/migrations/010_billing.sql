-- ============================================================================
--  010 — Usage metering & billing rates
-- ----------------------------------------------------------------------------
--  Billing is computed on demand from CDR + the tenant's plan. Plans carry a
--  monthly base fee (already present), a per-extension fee, and metered
--  per-minute rates for outbound/inbound. Minutes are billed from CDR.billsec
--  rounded up to whole minutes per call. Internal calls are free.
-- ============================================================================
ALTER TABLE plans
    ADD COLUMN per_extension_cents      integer NOT NULL DEFAULT 0,
    ADD COLUMN outbound_per_min_cents   integer NOT NULL DEFAULT 0,
    ADD COLUMN inbound_per_min_cents    integer NOT NULL DEFAULT 0,
    ADD COLUMN included_minutes         integer NOT NULL DEFAULT 0;  -- free pooled minutes/period

-- Sensible demo pricing per tier.
UPDATE plans SET per_extension_cents = 0,   outbound_per_min_cents = 2, inbound_per_min_cents = 1, included_minutes = 0     WHERE code = 'startup';
UPDATE plans SET per_extension_cents = 500, outbound_per_min_cents = 1, inbound_per_min_cents = 0, included_minutes = 2000  WHERE code = 'pro';
UPDATE plans SET per_extension_cents = 400, outbound_per_min_cents = 1, inbound_per_min_cents = 0, included_minutes = 10000 WHERE code = 'enterprise';

-- Optional snapshot of a finalized invoice (for history / idempotent export).
CREATE TABLE invoices (
    id              BIGSERIAL PRIMARY KEY,
    tenant_id       integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    period_start    date NOT NULL,
    period_end      date NOT NULL,
    currency        varchar(3) NOT NULL DEFAULT 'USD',
    line_items      jsonb NOT NULL,          -- [{label, qty, unit_cents, amount_cents}]
    total_cents     integer NOT NULL,
    generated_at    timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, period_start, period_end)
);
CREATE INDEX idx_invoices_tenant ON invoices (tenant_id, period_start DESC);
