-- ============================================================================
--  015 — Twilio account integration (auto-provision SIP trunks + import DIDs)
-- ----------------------------------------------------------------------------
--  Stores a tenant's Twilio API credentials so the platform can call Twilio's
--  Trunking + Numbers REST APIs on their behalf: auto-create an Elastic SIP
--  Trunk (trunk + credential list + origination URL pointing back at this PBX)
--  and import the account's phone numbers as DIDs.
--
--  The auth token is sensitive; it is never returned to the UI (the API masks
--  it). For production, prefer a Twilio API Key/Secret over the primary auth
--  token — both are supported (api_key_sid + api_key_secret used for HTTP auth
--  when present, else account_sid + auth_token).
-- ============================================================================
CREATE TABLE twilio_accounts (
    id              SERIAL PRIMARY KEY,
    tenant_id       integer NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
    account_sid     varchar(64) NOT NULL,
    auth_token      varchar(64),                 -- primary auth token (or use api key)
    api_key_sid     varchar(64),                 -- optional SKxx*, preferred for REST
    api_key_secret  varchar(80),
    -- Twilio object ids created/linked by auto-provisioning (for idempotency)
    trunk_sid       varchar(64),                 -- TKxxx Elastic SIP Trunk
    credential_list_sid varchar(64),             -- CLxxx
    domain_prefix   varchar(64),                 -- <prefix>.pstn.twilio.com termination
    -- local trunk row this Twilio trunk is wired to
    trunk_id        integer REFERENCES trunks(id) ON DELETE SET NULL,
    last_synced_at  timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_twilio_accounts_tenant ON twilio_accounts (tenant_id);

-- Tracks each phone number imported from Twilio (so re-imports are idempotent
-- and we know which numbers came from the account vs. were added manually).
ALTER TABLE dids
    ADD COLUMN twilio_sid varchar(64),           -- PNxxx IncomingPhoneNumber sid
    ADD COLUMN source     varchar(16) NOT NULL DEFAULT 'manual';  -- manual|twilio
CREATE INDEX idx_dids_twilio_sid ON dids (twilio_sid);
