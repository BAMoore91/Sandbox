-- ============================================================================
--  013 — Flows (Twilio Studio-style visual call flows)
-- ----------------------------------------------------------------------------
--  A flow is a JSON graph of widgets (nodes) + transitions, executed by an
--  ARI Stasis app in the API. A DID/destination of type 'flow' enters it.
--
--  Widget types:
--    say        — TTS / playback a prompt           (next)
--    gather     — collect DTMF digits into a var     (per-digit + default/timeout)
--    record     — capture voice + optional transcription (next)
--    http       — GET/POST webhook; capture response into vars (success/failure)
--    branch     — route on a variable expression     (cases + default)
--    dial       — dial an extension/number           (answered/noanswer)
--    route      — hand off to dispatch (queue/ext/vm/…) (terminal)
--    hangup     — end the call                        (terminal)
--  The definition shape is validated by the API (see flows router).
-- ============================================================================
CREATE TABLE flows (
    id              SERIAL PRIMARY KEY,
    tenant_id       integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    number          varchar(20) NOT NULL,            -- internal reference (like an IVR number)
    name            varchar(80),
    definition      jsonb NOT NULL DEFAULT '{"start":null,"widgets":{}}'::jsonb,
    enabled         boolean NOT NULL DEFAULT true,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, number)
);
CREATE INDEX idx_flows_tenant ON flows (tenant_id);

-- One row per flow execution (per call), with the live/var state + path taken.
CREATE TABLE flow_executions (
    id              BIGSERIAL PRIMARY KEY,
    flow_id         integer REFERENCES flows(id) ON DELETE CASCADE,
    tenant_id       integer,
    channel_id      varchar(150),                    -- ARI channel id
    caller          varchar(80),
    did             varchar(32),
    status          varchar(16) NOT NULL DEFAULT 'running',  -- running|completed|failed
    variables       jsonb NOT NULL DEFAULT '{}'::jsonb,
    path            jsonb NOT NULL DEFAULT '[]'::jsonb,       -- ordered widget ids visited
    error           text,
    started_at      timestamptz NOT NULL DEFAULT now(),
    ended_at        timestamptz
);
CREATE INDEX idx_flow_exec_flow ON flow_executions (flow_id, started_at DESC);
CREATE INDEX idx_flow_exec_tenant ON flow_executions (tenant_id, started_at DESC);

-- Captured recordings + transcriptions produced by 'record' widgets.
CREATE TABLE flow_recordings (
    id              BIGSERIAL PRIMARY KEY,
    execution_id    bigint REFERENCES flow_executions(id) ON DELETE CASCADE,
    tenant_id       integer,
    widget          varchar(80),
    path            varchar(255),                    -- file path (relative to recordings dir)
    duration        integer,
    transcript      text,
    transcript_status varchar(16) DEFAULT 'pending', -- pending|done|failed|disabled
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_flow_rec_exec ON flow_recordings (execution_id);

-- Audit of outbound webhook calls a flow made.
CREATE TABLE flow_webhook_log (
    id              BIGSERIAL PRIMARY KEY,
    execution_id    bigint REFERENCES flow_executions(id) ON DELETE CASCADE,
    tenant_id       integer,
    widget          varchar(80),
    method          varchar(8),
    url             varchar(500),
    status_code     integer,
    ok              boolean,
    error           text,
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_flow_webhook_exec ON flow_webhook_log (execution_id);

-- Seed a small demo flow for the demo tenant:
--   say welcome -> gather 1 digit -> press 1 routes to ext 1001, else hangup.
INSERT INTO flows (tenant_id, number, name, definition)
SELECT t.id, '900', 'Demo Flow', $json$
{
  "start": "w_welcome",
  "widgets": {
    "w_welcome": {"type":"say","text":"Welcome to the demo flow.","next":"w_menu"},
    "w_menu": {"type":"gather","text":"Press 1 for sales, 2 to leave a message.","num_digits":1,"variable":"choice","timeout":5,
               "transitions":{"1":"w_sales","2":"w_record"},"default":"w_bye"},
    "w_sales": {"type":"route","dest_type":"extension","dest_value":"1001"},
    "w_record": {"type":"record","max_seconds":60,"transcribe":true,"next":"w_bye"},
    "w_bye": {"type":"say","text":"Goodbye.","next":"w_end"},
    "w_end": {"type":"hangup"}
  }
}
$json$::jsonb
FROM tenants t WHERE t.slug = 'acme';
