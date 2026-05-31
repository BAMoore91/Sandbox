-- ============================================================================
--  002 — Tenant core: companies (tenants), subscription plans, users
-- ----------------------------------------------------------------------------
--  Read by the management API (not Asterisk). Tenant isolation is enforced by
--  scoping every API query to tenant_id and by per-tenant dialplan routing.
-- ============================================================================

-- ---- Subscription plans (mirrors 3CX edition tiers) -----------------------
CREATE TABLE plans (
    id                  SERIAL PRIMARY KEY,
    name                varchar(80)  NOT NULL,         -- Startup / Pro / Enterprise
    code                varchar(40)  NOT NULL UNIQUE,
    max_extensions      integer      NOT NULL DEFAULT 10,
    max_simultaneous_calls integer   NOT NULL DEFAULT 4,
    features            jsonb        NOT NULL DEFAULT '{}'::jsonb,
    monthly_price_cents integer      NOT NULL DEFAULT 0,
    created_at          timestamptz  NOT NULL DEFAULT now()
);

-- ---- Tenants (companies) --------------------------------------------------
CREATE TABLE tenants (
    id              SERIAL PRIMARY KEY,
    slug            varchar(40)  NOT NULL UNIQUE,       -- DNS-safe; used in endpoint ids
    name            varchar(150) NOT NULL,
    plan_id         integer      REFERENCES plans(id),
    status          varchar(20)  NOT NULL DEFAULT 'active',  -- active|suspended|trial
    sip_domain      varchar(150),                       -- optional vanity SIP domain
    timezone        varchar(64)  NOT NULL DEFAULT 'America/New_York',
    -- subscription / billing
    billing_email   varchar(150),
    trial_ends_at   timestamptz,
    -- routing defaults
    default_outbound_trunk_id integer,
    created_at      timestamptz  NOT NULL DEFAULT now(),
    updated_at      timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX idx_tenants_status ON tenants (status);

-- ---- Users (super-admins, tenant admins, agents) --------------------------
CREATE TABLE users (
    id              SERIAL PRIMARY KEY,
    tenant_id       integer REFERENCES tenants(id) ON DELETE CASCADE,  -- NULL = platform super-admin
    email           varchar(150) NOT NULL,
    password_hash   varchar(255) NOT NULL,
    full_name       varchar(150),
    role            varchar(20)  NOT NULL DEFAULT 'agent',  -- superadmin|admin|agent
    extension_id    integer,                                 -- linked extension (agents)
    is_active       boolean      NOT NULL DEFAULT true,
    last_login_at   timestamptz,
    created_at      timestamptz  NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, email)
);
-- super-admins (tenant_id NULL) must still have unique emails:
CREATE UNIQUE INDEX idx_users_global_email
    ON users (email) WHERE tenant_id IS NULL;

CREATE INDEX idx_users_tenant ON users (tenant_id);

-- ---- Audit log (who changed what; useful for multi-tenant support) --------
CREATE TABLE audit_log (
    id          BIGSERIAL PRIMARY KEY,
    tenant_id   integer,
    user_id     integer,
    action      varchar(80) NOT NULL,
    entity      varchar(80),
    entity_id   varchar(80),
    detail      jsonb,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_tenant ON audit_log (tenant_id, created_at DESC);
