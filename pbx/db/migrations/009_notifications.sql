-- ============================================================================
--  009 — Notifications: per-extension prefs + delivery outbox
-- ----------------------------------------------------------------------------
--  The dialplan enqueues an event into `notifications` on a missed call or a
--  new voicemail (via func_odbc). A background worker in the API drains the
--  outbox and delivers via email (SMTP) and/or SMS (Twilio REST), honoring
--  each extension's preferences and retrying with backoff.
-- ============================================================================

-- ---- Per-extension notification preferences -------------------------------
ALTER TABLE extensions
    ADD COLUMN notify_email          varchar(150),     -- defaults to email if null
    ADD COLUMN notify_sms            varchar(32),       -- E.164 mobile, optional
    ADD COLUMN notify_on_missed      boolean NOT NULL DEFAULT true,
    ADD COLUMN notify_on_voicemail   boolean NOT NULL DEFAULT true,
    ADD COLUMN notify_channel_email  boolean NOT NULL DEFAULT true,
    ADD COLUMN notify_channel_sms    boolean NOT NULL DEFAULT false;

-- ---- Delivery outbox ------------------------------------------------------
CREATE TABLE notifications (
    id            BIGSERIAL PRIMARY KEY,
    tenant_id     integer REFERENCES tenants(id) ON DELETE CASCADE,
    extension     varchar(20),
    event         varchar(20) NOT NULL,            -- missed | voicemail
    channel       varchar(10) NOT NULL,            -- email | sms
    recipient     varchar(150) NOT NULL,
    subject       varchar(200),
    body          text NOT NULL,
    caller        varchar(80),                     -- calling party number
    did           varchar(32),
    status        varchar(12) NOT NULL DEFAULT 'pending',  -- pending|sent|failed
    attempts      integer NOT NULL DEFAULT 0,
    last_error    text,
    created_at    timestamptz NOT NULL DEFAULT now(),
    sent_at       timestamptz,
    next_attempt_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_notifications_pending
    ON notifications (status, next_attempt_at) WHERE status = 'pending';
CREATE INDEX idx_notifications_tenant ON notifications (tenant_id, created_at DESC);

-- Demo: give the demo extensions an SMS target + enable SMS channel for 1001.
UPDATE extensions SET notify_sms = '+15555550101', notify_channel_sms = true
 WHERE tenant_id = (SELECT id FROM tenants WHERE slug='acme') AND extension = '1001';
