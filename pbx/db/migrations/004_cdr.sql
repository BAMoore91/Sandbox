-- ============================================================================
--  004 — Call Detail Records + recordings
-- ----------------------------------------------------------------------------
--  Written by Asterisk cdr_adaptive_odbc. The adaptive backend writes
--  whatever CDR variables match column names, so extra columns (tenant_id)
--  are populated from a channel var we set in the dialplan.
-- ============================================================================
CREATE TABLE cdr (
    id          BIGSERIAL PRIMARY KEY,
    calldate    timestamptz NOT NULL DEFAULT now(),
    clid        varchar(80),
    src         varchar(80),
    dst         varchar(80),
    dcontext    varchar(80),
    channel     varchar(80),
    dstchannel  varchar(80),
    lastapp     varchar(80),
    lastdata    varchar(255),
    duration    integer,
    billsec     integer,
    disposition varchar(45),
    amaflags    integer,
    accountcode varchar(80),
    uniqueid    varchar(150),
    userfield   varchar(255),
    tenant_id   integer,
    did         varchar(32),
    direction   varchar(12),         -- inbound|outbound|internal
    recording   varchar(255)
);
CREATE INDEX idx_cdr_tenant_date ON cdr (tenant_id, calldate DESC);
CREATE INDEX idx_cdr_uniqueid ON cdr (uniqueid);

-- Optional call-recording catalog (file paths produced by MixMonitor).
CREATE TABLE recordings (
    id          BIGSERIAL PRIMARY KEY,
    tenant_id   integer NOT NULL,
    uniqueid    varchar(150),
    path        varchar(255) NOT NULL,
    src         varchar(80),
    dst         varchar(80),
    duration    integer,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_recordings_tenant ON recordings (tenant_id, created_at DESC);
