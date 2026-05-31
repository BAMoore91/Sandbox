-- ============================================================================
--  016 — Fax (inbound fax-to-email + outbound send-fax over T.38/spandsp)
-- ----------------------------------------------------------------------------
--  Inbound:  a DID with dest_type='fax' answers, runs ReceiveFAX to a TIFF in
--            the shared spool, then the API converts it to PDF and emails it to
--            the fax box's recipients (fax-to-email).
--  Outbound: the portal uploads a PDF; the API converts to TIFF, originates a
--            call via ARI into [fax-send], which runs SendFAX.
--  Both directions log a row in `faxes`. T.38 is enabled on endpoints/trunks.
-- ============================================================================

-- Per-DID fax box: where inbound faxes for a number are emailed.
CREATE TABLE fax_boxes (
    id            SERIAL PRIMARY KEY,
    tenant_id     integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    number        varchar(20) NOT NULL,            -- internal fax id (DID dest_value)
    name          varchar(80),
    email         varchar(255),                    -- comma-separated recipients
    header        varchar(80),                     -- station id / TSID shown to sender
    enabled       boolean NOT NULL DEFAULT true,
    created_at    timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, number)
);
CREATE INDEX idx_fax_boxes_tenant ON fax_boxes (tenant_id);

-- Fax jobs (inbound received + outbound sent).
CREATE TABLE faxes (
    id            BIGSERIAL PRIMARY KEY,
    tenant_id     integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    direction     varchar(8)  NOT NULL,            -- inbound | outbound
    faxbox        varchar(20),                     -- inbound: fax box number
    src           varchar(80),                     -- sender (inbound) / caller id (outbound)
    dst           varchar(80),                     -- our DID (inbound) / dialed number (outbound)
    status        varchar(16) NOT NULL DEFAULT 'pending', -- pending|sending|received|sent|failed
    pages         integer,
    tiff_path     varchar(255),                    -- path on the shared fax volume
    pdf_path      varchar(255),
    error         text,
    channel_id    varchar(150),                    -- ARI channel (outbound)
    created_at    timestamptz NOT NULL DEFAULT now(),
    completed_at  timestamptz
);
CREATE INDEX idx_faxes_tenant ON faxes (tenant_id, created_at DESC);

-- Demo: a fax box on the demo tenant + a DID pointing at it.
INSERT INTO fax_boxes (tenant_id, number, name, email, header)
SELECT t.id, '7000', 'Main Fax', 'fax@acme.example', 'ACME CORP'
FROM tenants t WHERE t.slug = 'acme';
