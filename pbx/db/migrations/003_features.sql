-- ============================================================================
--  003 — Telephony features (the "3CX-like" call-handling objects)
-- ----------------------------------------------------------------------------
--  Most tables here are read by the dialplan through func_odbc (see
--  asterisk/etc/func_odbc.conf) and managed by the API. Queues use the
--  upstream Asterisk realtime schema so app_queue works natively.
--
--  Destination model (used by dids, ivr_options, ring_groups, time_conditions):
--     dest_type ∈ extension | ringgroup | queue | ivr | voicemail
--                 | timecondition | external | hangup | playback
--     dest_value = the target's number / id (interpreted per type)
-- ============================================================================

-- ---- Extensions (management view over ps_endpoints) -----------------------
CREATE TABLE extensions (
    id              SERIAL PRIMARY KEY,
    tenant_id       integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    extension       varchar(20)  NOT NULL,       -- e.g. 1001 (unique per tenant)
    display_name    varchar(150),
    endpoint_id     varchar(255) NOT NULL,        -- '<slug>-<extension>' -> ps_endpoints.id
    email           varchar(150),
    outbound_cid    varchar(40),                  -- E.164 presented on outbound (must be Twilio-owned)
    voicemail_enabled boolean NOT NULL DEFAULT true,
    vm_pin          varchar(20)  DEFAULT '0000',
    call_forward    varchar(40),                  -- unconditional CF target
    dnd             boolean NOT NULL DEFAULT false,
    ring_seconds    integer NOT NULL DEFAULT 25,
    webrtc          boolean NOT NULL DEFAULT true,
    created_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, extension)
);
CREATE INDEX idx_extensions_tenant ON extensions (tenant_id);

-- ---- SIP trunks (Twilio Elastic SIP Trunk, or any provider) ---------------
CREATE TABLE trunks (
    id              SERIAL PRIMARY KEY,
    tenant_id       integer REFERENCES tenants(id) ON DELETE CASCADE,  -- NULL = shared platform trunk
    name            varchar(80)  NOT NULL,
    provider        varchar(40)  NOT NULL DEFAULT 'twilio',
    endpoint_id     varchar(255) NOT NULL,        -- 'trunk-<id>' -> ps_endpoints.id
    -- Twilio Termination (outbound): termination SIP URI host
    sip_server      varchar(255) NOT NULL,        -- e.g. your-trunk.pstn.twilio.com
    sip_port        integer NOT NULL DEFAULT 5060,
    transport       varchar(40)  NOT NULL DEFAULT 'transport-udp',
    -- auth: either credentials (username/secret) OR ip-acl (origination IPs)
    auth_mode       varchar(20)  NOT NULL DEFAULT 'credentials', -- credentials|ipacl
    username        varchar(150),
    secret          varchar(255),
    from_domain     varchar(255),                 -- Twilio termination domain
    register        boolean NOT NULL DEFAULT false,
    codecs          varchar(120) NOT NULL DEFAULT 'ulaw,alaw',
    media_encryption varchar(16) NOT NULL DEFAULT 'no',  -- 'no' or 'sdes' for secure trunking
    max_channels    integer,
    enabled         boolean NOT NULL DEFAULT true,
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_trunks_tenant ON trunks (tenant_id);

-- Twilio origination source IPs allowed to deliver inbound calls to a trunk.
CREATE TABLE trunk_acl (
    id          SERIAL PRIMARY KEY,
    trunk_id    integer NOT NULL REFERENCES trunks(id) ON DELETE CASCADE,
    cidr        varchar(64) NOT NULL
);

-- ---- DIDs / inbound numbers ----------------------------------------------
CREATE TABLE dids (
    id              SERIAL PRIMARY KEY,
    tenant_id       integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    number          varchar(32) NOT NULL UNIQUE,   -- E.164, e.g. +13105551234
    trunk_id        integer REFERENCES trunks(id),
    description     varchar(150),
    cid_name_prefix varchar(40),
    -- normal-hours destination
    dest_type       varchar(20) NOT NULL DEFAULT 'extension',
    dest_value      varchar(40) NOT NULL,
    -- optional time condition wrapper (overrides dest_* when set)
    time_condition_id integer,
    enabled         boolean NOT NULL DEFAULT true,
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_dids_tenant ON dids (tenant_id);

-- ---- Outbound routes (pattern -> trunk + transforms) ----------------------
CREATE TABLE outbound_routes (
    id              SERIAL PRIMARY KEY,
    tenant_id       integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name            varchar(80) NOT NULL,
    priority        integer NOT NULL DEFAULT 100,  -- lower = matched first
    pattern         varchar(64) NOT NULL,          -- human/Asterisk pattern shown in UI, e.g. _1NXXNXXXXXX
    regexp          varchar(128) NOT NULL,         -- POSIX regex used for matching in the dialplan
    trunk_id        integer NOT NULL REFERENCES trunks(id),
    strip_digits    integer NOT NULL DEFAULT 0,    -- strip N leading digits
    prepend         varchar(20) DEFAULT '',        -- prepend before dialing (e.g. +1)
    caller_id       varchar(40),                   -- override outbound CID (E.164)
    enabled         boolean NOT NULL DEFAULT true
);
CREATE INDEX idx_outbound_tenant ON outbound_routes (tenant_id, priority);

-- ---- Ring groups ----------------------------------------------------------
CREATE TABLE ring_groups (
    id              SERIAL PRIMARY KEY,
    tenant_id       integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    number          varchar(20) NOT NULL,
    name            varchar(80),
    strategy        varchar(20) NOT NULL DEFAULT 'ringall', -- ringall|hunt|memoryhunt
    ring_seconds    integer NOT NULL DEFAULT 25,
    -- members stored as ordered CSV of extension numbers for fast func_odbc read
    members         varchar(255) NOT NULL DEFAULT '',
    fail_dest_type  varchar(20) NOT NULL DEFAULT 'voicemail',
    fail_dest_value varchar(40),
    enabled         boolean NOT NULL DEFAULT true,
    UNIQUE (tenant_id, number)
);

-- ---- IVR (auto-attendant) menus -------------------------------------------
CREATE TABLE ivr_menus (
    id              SERIAL PRIMARY KEY,
    tenant_id       integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    number          varchar(20) NOT NULL,           -- internal reference number
    name            varchar(80),
    greeting        varchar(120) NOT NULL DEFAULT 'custom/ivr-welcome', -- sound file (no ext)
    timeout         integer NOT NULL DEFAULT 5,
    max_retries     integer NOT NULL DEFAULT 3,
    direct_dial     boolean NOT NULL DEFAULT true,   -- allow dialing extensions directly
    invalid_dest_type  varchar(20) NOT NULL DEFAULT 'hangup',
    invalid_dest_value varchar(40),
    timeout_dest_type  varchar(20) NOT NULL DEFAULT 'hangup',
    timeout_dest_value varchar(40),
    UNIQUE (tenant_id, number)
);

CREATE TABLE ivr_options (
    id          SERIAL PRIMARY KEY,
    ivr_id      integer NOT NULL REFERENCES ivr_menus(id) ON DELETE CASCADE,
    digit       varchar(4) NOT NULL,                -- 0-9, *, #
    dest_type   varchar(20) NOT NULL,
    dest_value  varchar(40) NOT NULL,
    UNIQUE (ivr_id, digit)
);

-- ---- Time conditions (business-hours routing) -----------------------------
CREATE TABLE time_conditions (
    id              SERIAL PRIMARY KEY,
    tenant_id       integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    number          varchar(20) NOT NULL,
    name            varchar(80),
    timezone        varchar(64),                    -- defaults to tenant tz
    match_dest_type   varchar(20) NOT NULL,         -- in-hours destination
    match_dest_value  varchar(40) NOT NULL,
    nomatch_dest_type  varchar(20) NOT NULL,        -- out-of-hours destination
    nomatch_dest_value varchar(40) NOT NULL,
    UNIQUE (tenant_id, number)
);

-- one or more time ranges that count as "in hours" (GotoIfTime syntax parts)
CREATE TABLE time_ranges (
    id              SERIAL PRIMARY KEY,
    time_condition_id integer NOT NULL REFERENCES time_conditions(id) ON DELETE CASCADE,
    times           varchar(40) NOT NULL DEFAULT '*',   -- e.g. 09:00-17:00
    weekdays        varchar(40) NOT NULL DEFAULT '*',   -- e.g. mon-fri
    monthdays       varchar(40) NOT NULL DEFAULT '*',   -- e.g. 1-31
    months          varchar(40) NOT NULL DEFAULT '*'    -- e.g. jan-dec
);

-- ============================================================================
--  Queues — upstream Asterisk realtime schema (app_queue reads these).
--  Queue name convention: '<tenant_slug>-<queue_number>'.
-- ============================================================================
CREATE TABLE queues (
    name                    varchar(128) PRIMARY KEY,
    musiconhold             varchar(128),
    announce                varchar(128),
    context                 varchar(128),
    timeout                 integer DEFAULT 15,
    monitor_type            varchar(128),
    monitor_format          varchar(128),
    queue_youarenext        varchar(128),
    queue_thereare          varchar(128),
    queue_callswaiting      varchar(128),
    queue_holdtime          varchar(128),
    queue_minutes           varchar(128),
    queue_seconds           varchar(128),
    queue_thankyou          varchar(128),
    queue_reporthold        varchar(128),
    announce_frequency      integer,
    announce_holdtime       varchar(128),
    retry                   integer DEFAULT 5,
    wrapuptime              integer DEFAULT 0,
    maxlen                  integer DEFAULT 0,
    servicelevel            integer,
    strategy                varchar(128) DEFAULT 'ringall',
    joinempty               varchar(128) DEFAULT 'yes',
    leavewhenempty          varchar(128) DEFAULT 'no',
    ringinuse               varchar(128) DEFAULT 'no',
    reportholdtime          varchar(128),
    memberdelay             integer,
    weight                  integer,
    timeoutrestart          varchar(128),
    periodic_announce       varchar(128),
    periodic_announce_frequency integer,
    tenant_id               integer
);

CREATE TABLE queue_members (
    queue_name      varchar(128) NOT NULL,
    interface       varchar(128) NOT NULL,        -- e.g. PJSIP/acme-1001 or Local/...
    membername      varchar(128),
    state_interface varchar(128),
    penalty         integer DEFAULT 0,
    paused          integer DEFAULT 0,
    wrapuptime      integer,
    uniqueid        SERIAL,
    PRIMARY KEY (queue_name, interface)
);
