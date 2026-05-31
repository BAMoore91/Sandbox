-- ============================================================================
--  001 — PJSIP realtime schema
-- ----------------------------------------------------------------------------
--  These tables are read DIRECTLY by Asterisk (res_config_odbc / sorcery).
--  Column names/types follow the upstream Asterisk realtime schema so the
--  stock res_pjsip realtime mapping works unchanged. Asterisk ignores any
--  columns it doesn't know about, so we add `tenant_id` for API scoping.
--
--  Endpoint naming convention (multi-tenancy):
--     ps_endpoints.id  =  '<tenant_slug>-<extension>'   e.g.  'acme-1001'
--     ps_endpoints.id  =  'trunk-<trunk_id>'            for SIP trunks
--  Per-endpoint channel vars carry the tenant into the dialplan via set_var.
-- ============================================================================

-- ---- Address of Record ----------------------------------------------------
CREATE TABLE ps_aors (
    id                   varchar(255) PRIMARY KEY,
    contact              varchar(255),
    default_expiration   integer,
    mailboxes            varchar(80),
    max_contacts         integer DEFAULT 1,
    minimum_expiration   integer,
    remove_existing      varchar(5)  DEFAULT 'yes',
    qualify_frequency    integer     DEFAULT 60,
    authenticate_qualify varchar(5),
    maximum_expiration   integer,
    qualify_timeout      numeric,
    support_path         varchar(5),
    tenant_id            integer
);

-- ---- Authentication -------------------------------------------------------
CREATE TABLE ps_auths (
    id                varchar(255) PRIMARY KEY,
    auth_type         varchar(16) DEFAULT 'userpass',
    nonce_lifetime    integer,
    md5_cred          varchar(40),
    password          varchar(255),
    realm             varchar(255),
    username          varchar(255),
    tenant_id         integer
);

-- ---- Endpoints (phones AND trunks) ----------------------------------------
CREATE TABLE ps_endpoints (
    id                       varchar(255) PRIMARY KEY,
    transport                varchar(40),
    aors                     varchar(255),
    auth                     varchar(255),
    context                  varchar(80) DEFAULT 'from-internal',
    disallow                 varchar(255) DEFAULT 'all',
    allow                    varchar(255) DEFAULT 'ulaw,alaw,opus',
    direct_media             varchar(5)  DEFAULT 'no',
    callerid                 varchar(255),
    callerid_privacy         varchar(40),
    mailboxes                varchar(80),
    dtmf_mode                varchar(16) DEFAULT 'rfc4733',
    rtp_symmetric            varchar(5)  DEFAULT 'yes',
    force_rport              varchar(5)  DEFAULT 'yes',
    rewrite_contact          varchar(5)  DEFAULT 'yes',
    ice_support              varchar(5)  DEFAULT 'no',
    media_encryption         varchar(16) DEFAULT 'no',
    media_use_received_transport varchar(5),
    rtcp_mux                 varchar(5),
    use_avpf                 varchar(5),
    webrtc                   varchar(5),
    dtls_auto_generate_cert  varchar(5),
    from_user                varchar(255),
    from_domain              varchar(255),
    outbound_auth            varchar(255),
    aggregate_mwi            varchar(5),
    trust_id_inbound         varchar(5),
    send_pai                 varchar(5),
    send_rpid                varchar(5),
    language                 varchar(10) DEFAULT 'en',
    call_group               varchar(40),
    pickup_group             varchar(40),
    named_call_group         varchar(40),
    named_pickup_group       varchar(40),
    device_state_busy_at     integer,
    t38_udptl                varchar(5),
    allow_subscribe          varchar(5),
    set_var                  text,
    accountcode              varchar(80),
    tenant_id                integer
);

-- ---- Dynamic contacts (written by Asterisk on REGISTER) -------------------
CREATE TABLE ps_contacts (
    id                 varchar(255) PRIMARY KEY,
    uri                varchar(511),
    expiration_time    bigint,
    qualify_frequency  integer,
    outbound_proxy     varchar(255),
    path               text,
    user_agent         varchar(255),
    reg_server         varchar(255),
    authenticate_qualify varchar(5),
    via_addr           varchar(40),
    via_port           integer,
    call_id            varchar(255),
    endpoint           varchar(255),
    prune_on_boot      varchar(5),
    qualify_timeout    numeric
);

-- ---- IP-based identify (match Twilio origination IPs -> trunk endpoint) ---
CREATE TABLE ps_endpoint_id_ips (
    id          varchar(255) PRIMARY KEY,
    endpoint    varchar(255),
    "match"     varchar(80),
    srv_lookups varchar(5),
    match_header varchar(255),
    tenant_id   integer
);

-- ---- Outbound registrations (e.g. register to Twilio if not IP auth) ------
CREATE TABLE ps_registrations (
    id                    varchar(255) PRIMARY KEY,
    transport             varchar(40),
    server_uri            varchar(255),
    client_uri            varchar(255),
    contact_user          varchar(40),
    outbound_auth         varchar(255),
    retry_interval        integer,
    max_retries           integer,
    expiration            integer,
    auth_rejection_permanent varchar(5),
    line                  varchar(5),
    endpoint              varchar(255),
    tenant_id             integer
);

-- ---- Voicemail (realtime app_voicemail) -----------------------------------
--  context convention: voicemail context == tenant slug, mailbox == extension
CREATE TABLE voicemail (
    uniqueid    SERIAL PRIMARY KEY,
    context     varchar(80)  NOT NULL,
    mailbox     varchar(80)  NOT NULL,
    password    varchar(80)  NOT NULL DEFAULT '0000',
    fullname    varchar(150),
    email       varchar(150),
    pager       varchar(150),
    attach      varchar(4)   DEFAULT 'yes',
    saycid      varchar(4),
    dialout     varchar(10),
    callback    varchar(10),
    review      varchar(4),
    operator    varchar(4),
    envelope    varchar(4),
    sayduration varchar(4),
    saydurationm integer,
    sendvoicemail varchar(4),
    "delete"    varchar(4)   DEFAULT 'no',
    nextaftercmd varchar(4),
    forcename   varchar(4),
    forcegreetings varchar(4),
    hidefromdir varchar(4),
    stamp       timestamp,
    tenant_id   integer,
    UNIQUE (context, mailbox)
);

CREATE INDEX idx_ps_endpoints_tenant ON ps_endpoints (tenant_id);
CREATE INDEX idx_ps_contacts_endpoint ON ps_contacts (endpoint);
CREATE INDEX idx_ps_eidips_endpoint ON ps_endpoint_id_ips (endpoint);
