-- ============================================================================
--  012 — Auto phone provisioning + BLF key configuration
-- ----------------------------------------------------------------------------
--  devices : physical desk phones identified by MAC, assigned to an extension.
--            The provisioning endpoint serves a per-vendor config file by MAC
--            containing the SIP account + line/BLF keys.
--  blf_keys: per-extension programmable keys (BLF/speed-dial/line) rendered
--            into the phone's config and backed by dialplan hints.
--
--  BLF hints
--  ---------
--  Hints can't live in a shared context (numbers collide across tenants), so
--  each tenant gets a generated context `tenant-<slug>` that `include`s
--  from-internal and declares `exten => <n>,hint,PJSIP/<slug>-<n>` for every
--  extension. Endpoints are moved into that context. The file is regenerated
--  from this DB on every extension change (see api/app/dialplan_gen.py).
-- ============================================================================

CREATE TABLE devices (
    id              SERIAL PRIMARY KEY,
    tenant_id       integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    mac             varchar(12) NOT NULL UNIQUE,     -- normalized lowercase, no separators
    vendor          varchar(20) NOT NULL DEFAULT 'yealink',  -- yealink|grandstream
    model           varchar(40),
    extension       varchar(20),                     -- assigned extension number (line 1)
    label           varchar(80),
    provision_token varchar(64),                     -- optional shared secret in the URL
    last_seen_at    timestamptz,
    last_ip         varchar(45),
    created_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, extension)
);
CREATE INDEX idx_devices_tenant ON devices (tenant_id);

CREATE TABLE blf_keys (
    id          SERIAL PRIMARY KEY,
    tenant_id   integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    extension   varchar(20) NOT NULL,                -- the OWNER extension (whose phone has the key)
    key_index   integer NOT NULL,                    -- 1-based programmable key position
    key_type    varchar(16) NOT NULL DEFAULT 'blf',  -- blf|speeddial|line
    label       varchar(40),
    value       varchar(40) NOT NULL,                -- monitored ext (blf) or number (speeddial)
    UNIQUE (tenant_id, extension, key_index)
);
CREATE INDEX idx_blf_tenant_ext ON blf_keys (tenant_id, extension);

-- Move existing seeded endpoints into their per-tenant context so BLF works.
UPDATE ps_endpoints e
   SET context = 'tenant-' || t.slug
  FROM tenants t
 WHERE e.tenant_id = t.id
   AND e.context = 'from-internal';
