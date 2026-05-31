-- ============================================================================
--  006 — Custom audio prompts (greetings / announcements / MoH)
-- ----------------------------------------------------------------------------
--  Customers upload audio in the portal; the API transcodes it to 8 kHz mono
--  PCM WAV and stores it on the shared sounds volume at
--      <sounds>/<tenant_slug>/<name>.wav
--  which Asterisk references in the dialplan as  custom/<tenant_slug>/<name>.
-- ============================================================================
CREATE TABLE prompts (
    id            SERIAL PRIMARY KEY,
    tenant_id     integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name          varchar(60)  NOT NULL,        -- dns-safe slug used in the filename
    description   varchar(150),
    kind          varchar(20)  NOT NULL DEFAULT 'greeting',  -- greeting|announcement|moh
    -- Asterisk sound id (no extension), e.g. custom/acme/welcome
    sound_id      varchar(160) NOT NULL,
    filename      varchar(200) NOT NULL,        -- absolute path on the sounds volume
    duration_sec  numeric,
    size_bytes    integer,
    original_name varchar(200),
    created_at    timestamptz  NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, name)
);
CREATE INDEX idx_prompts_tenant ON prompts (tenant_id);
