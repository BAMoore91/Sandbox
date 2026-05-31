-- ============================================================================
--  017 — Call journaling: forward all CDRs to an external database / webhook
-- ----------------------------------------------------------------------------
--  A "sink" is an external destination every new CDR row is forwarded to:
--    * postgres — INSERT into a table in an external PostgreSQL (via DSN)
--    * webhook  — HTTP POST a JSON batch to a URL
--  A sink is scoped to one tenant, or platform-wide (tenant_id NULL, super-admin)
--  which forwards every tenant's calls.
--
--  Delivery uses an append-only cursor: cdr.id is monotonic, so each sink
--  tracks the highest cdr id it has confirmed delivered. The worker forwards
--  rows with id > cursor in id order and only advances the cursor for rows the
--  destination accepted — so a failure simply retries from where it left off,
--  with no loss and no duplicates (idempotent on the cdr id).
-- ============================================================================
CREATE TABLE call_journal_sinks (
    id            SERIAL PRIMARY KEY,
    tenant_id     integer REFERENCES tenants(id) ON DELETE CASCADE,  -- NULL = platform-wide
    name          varchar(80) NOT NULL,
    type          varchar(16) NOT NULL,            -- postgres | webhook
    -- postgres sink
    dsn           text,                            -- postgresql://user:pass@host/db
    target_table  varchar(120) NOT NULL DEFAULT 'pbx_cdr',
    -- webhook sink
    url           text,
    auth_header   text,                            -- optional 'Authorization' value
    batch_size    integer NOT NULL DEFAULT 200,
    enabled       boolean NOT NULL DEFAULT true,
    -- delivery state
    cursor_id     bigint NOT NULL DEFAULT 0,       -- highest cdr.id confirmed delivered
    last_run_at   timestamptz,
    last_status   varchar(16),                     -- ok | error
    last_error    text,
    delivered_total bigint NOT NULL DEFAULT 0,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_journal_sinks_enabled ON call_journal_sinks (enabled);

-- Per-run audit so the portal can show journaling health.
CREATE TABLE call_journal_runs (
    id            BIGSERIAL PRIMARY KEY,
    sink_id       integer REFERENCES call_journal_sinks(id) ON DELETE CASCADE,
    started_at    timestamptz NOT NULL DEFAULT now(),
    finished_at   timestamptz,
    rows_sent     integer NOT NULL DEFAULT 0,
    from_id       bigint,
    to_id         bigint,
    status        varchar(16),                     -- ok | error
    error         text
);
CREATE INDEX idx_journal_runs_sink ON call_journal_runs (sink_id, started_at DESC);
