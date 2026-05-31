-- ============================================================================
--  011 — Stripe billing integration + invoice payment lifecycle
-- ----------------------------------------------------------------------------
--  Finalized invoices can be charged via Stripe. We store the tenant's Stripe
--  customer id and track each invoice's payment state + the Stripe object ids
--  so charges are idempotent and auditable.
-- ============================================================================
ALTER TABLE tenants
    ADD COLUMN stripe_customer_id varchar(64),
    ADD COLUMN auto_bill          boolean NOT NULL DEFAULT false;  -- charge on auto-finalize

ALTER TABLE invoices
    ADD COLUMN status          varchar(16) NOT NULL DEFAULT 'open',  -- open|paid|failed|void
    ADD COLUMN stripe_payment_intent varchar(64),
    ADD COLUMN paid_at         timestamptz,
    ADD COLUMN last_error      text;

-- Tracks each scheduled auto-finalize run (audit + visibility, advisory-locked).
CREATE TABLE billing_runs (
    id              BIGSERIAL PRIMARY KEY,
    period_start    date NOT NULL,
    period_end      date NOT NULL,
    started_at      timestamptz NOT NULL DEFAULT now(),
    finished_at     timestamptz,
    invoices_made   integer NOT NULL DEFAULT 0,
    charges_ok      integer NOT NULL DEFAULT 0,
    charges_failed  integer NOT NULL DEFAULT 0,
    error           text
);
