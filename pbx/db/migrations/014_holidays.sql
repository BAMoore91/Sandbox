-- ============================================================================
--  014 — Holiday hours (closed-day overrides for time conditions)
-- ----------------------------------------------------------------------------
--  A holiday forces a time condition CLOSED for the day, overriding the normal
--  open-hours ranges. This is the opposite precedence from open ranges, so it
--  must be checked FIRST in the dialplan: if today matches a holiday ->
--  holiday/closed destination; else evaluate open ranges as before.
--
--  Holidays attach to a time_condition. Each is either a one-off (a specific
--  date) or recurring (same month/day every year). An optional time range lets
--  you model partial-day closures (e.g. close at noon on Christmas Eve);
--  default is all day. An optional per-holiday destination overrides the time
--  condition's normal closed (nomatch) destination (e.g. a special holiday
--  greeting); when null, the closed destination is used.
-- ============================================================================
CREATE TABLE holidays (
    id                SERIAL PRIMARY KEY,
    time_condition_id integer NOT NULL REFERENCES time_conditions(id) ON DELETE CASCADE,
    tenant_id         integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name              varchar(80) NOT NULL,
    recurring         boolean NOT NULL DEFAULT true,   -- same date every year
    month             integer NOT NULL,                -- 1-12
    day               integer NOT NULL,                -- 1-31
    year              integer,                         -- required when not recurring
    times             varchar(40) NOT NULL DEFAULT '*',-- '*' = all day, or HH:MM-HH:MM
    -- optional override destination for this holiday (else use TC closed dest)
    dest_type         varchar(20),
    dest_value        varchar(40),
    enabled           boolean NOT NULL DEFAULT true,
    created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_holidays_tc ON holidays (time_condition_id);
CREATE INDEX idx_holidays_tenant ON holidays (tenant_id);

-- Demo: Christmas Day closure on the demo tenant's Business Hours condition.
INSERT INTO holidays (time_condition_id, tenant_id, name, recurring, month, day, times)
SELECT c.id, c.tenant_id, 'Christmas Day', true, 12, 25, '*'
FROM time_conditions c JOIN tenants t ON t.id = c.tenant_id
WHERE t.slug = 'acme' AND c.number = '700';
