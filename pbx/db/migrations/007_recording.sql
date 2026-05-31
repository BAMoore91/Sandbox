-- ============================================================================
--  007 — Per-tenant call recording toggle
-- ----------------------------------------------------------------------------
--  When enabled, the dialplan starts MixMonitor on answered call legs and
--  stamps the relative file path into cdr.recording. Recordings are written to
--  the shared `asterisk_monitor` volume at:
--      /var/spool/asterisk/monitor/<tenant_slug>/<YYYY>/<MM>/<DD>/<uniqueid>.wav
--  and served back through the API (read from the same volume).
-- ============================================================================
ALTER TABLE tenants ADD COLUMN recording_enabled boolean NOT NULL DEFAULT false;

-- Turn it on for the demo tenant (Pro plan includes recording).
UPDATE tenants SET recording_enabled = true WHERE slug = 'acme';
