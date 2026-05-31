-- ============================================================================
--  005 — Seed data: subscription plans + a demo tenant ("acme")
-- ----------------------------------------------------------------------------
--  Demonstrates a fully-wired tenant: 2 extensions, a shared Twilio trunk
--  (disabled until you add real credentials), a DID -> IVR -> ring group,
--  voicemail, and an outbound route. The platform super-admin user is created
--  by the API on first boot (see BOOTSTRAP_ADMIN_* in .env).
-- ============================================================================

INSERT INTO plans (name, code, max_extensions, max_simultaneous_calls, monthly_price_cents, features) VALUES
 ('Startup',    'startup',    10,   4,   0,    '{"ivr":true,"queues":false,"recording":false,"ringgroups":true}'),
 ('Pro',        'pro',        50,   16,  1500, '{"ivr":true,"queues":true,"recording":true,"ringgroups":true}'),
 ('Enterprise', 'enterprise', 1000, 256, 5000, '{"ivr":true,"queues":true,"recording":true,"ringgroups":true,"sso":true}');

-- ---- Demo tenant ----------------------------------------------------------
INSERT INTO tenants (slug, name, plan_id, status, timezone, billing_email)
VALUES ('acme', 'Acme Corporation', (SELECT id FROM plans WHERE code='pro'),
        'active', 'America/New_York', 'billing@acme.example');

-- ---- Extensions 1001 & 1002 (PJSIP realtime rows + management rows) --------
-- AOR / Auth / Endpoint for 1001 (WebRTC-capable)
INSERT INTO ps_aors (id, max_contacts, remove_existing, qualify_frequency, tenant_id)
 VALUES ('acme-1001', 2, 'yes', 60, 1), ('acme-1002', 2, 'yes', 60, 1);

INSERT INTO ps_auths (id, auth_type, username, password, tenant_id) VALUES
 ('acme-1001', 'userpass', 'acme-1001', 'Demo-Pass-1001!', 1),
 ('acme-1002', 'userpass', 'acme-1002', 'Demo-Pass-1002!', 1);

INSERT INTO ps_endpoints
 (id, transport, aors, auth, context, disallow, allow, callerid, mailboxes,
  webrtc, use_avpf, media_encryption, dtls_auto_generate_cert, rtcp_mux, ice_support,
  rtp_symmetric, force_rport, rewrite_contact, set_var, accountcode, tenant_id)
VALUES
 ('acme-1001', 'transport-wss', 'acme-1001', 'acme-1001', 'from-internal',
  'all', 'opus,ulaw,alaw', 'Alice <1001>', 'acme-1001@acme',
  'yes','yes','dtls','yes','yes','yes','yes','yes','yes',
  'TENANT=acme,MYEXTEN=1001', 'acme', 1),
 ('acme-1002', 'transport-wss', 'acme-1002', 'acme-1002', 'from-internal',
  'all', 'opus,ulaw,alaw', 'Bob <1002>', 'acme-1002@acme',
  'yes','yes','dtls','yes','yes','yes','yes','yes','yes',
  'TENANT=acme,MYEXTEN=1002', 'acme', 1);

INSERT INTO extensions (tenant_id, extension, display_name, endpoint_id, email, voicemail_enabled, vm_pin) VALUES
 (1, '1001', 'Alice', 'acme-1001', 'alice@acme.example', true, '1234'),
 (1, '1002', 'Bob',   'acme-1002', 'bob@acme.example',   true, '1234');

INSERT INTO voicemail (context, mailbox, password, fullname, email, tenant_id) VALUES
 ('acme', '1001', '1234', 'Alice', 'alice@acme.example', 1),
 ('acme', '1002', '1234', 'Bob',   'bob@acme.example',   1);

-- ---- Shared Twilio trunk (disabled until you set real credentials) --------
-- Endpoint id 'trunk-1'. Fill sip_server/username/secret from your Twilio
-- Termination settings, then enable + re-provision via the API.
INSERT INTO trunks (id, tenant_id, name, provider, endpoint_id, sip_server, sip_port,
                    transport, auth_mode, username, secret, from_domain, codecs, enabled)
VALUES (1, NULL, 'Twilio Shared', 'twilio', 'trunk-1',
        'your-trunk.pstn.twilio.com', 5060, 'transport-udp',
        'credentials', 'CHANGE_ME', 'CHANGE_ME',
        'your-trunk.pstn.twilio.com', 'ulaw,alaw', false);
SELECT setval('trunks_id_seq', 1, true);

-- Trunk PJSIP rows (outbound auth + aor + endpoint with context from-twilio).
INSERT INTO ps_aors (id, contact, qualify_frequency, max_contacts, tenant_id)
 VALUES ('trunk-1', 'sip:your-trunk.pstn.twilio.com:5060', 60, 1, NULL);
INSERT INTO ps_auths (id, auth_type, username, password, tenant_id)
 VALUES ('trunk-1', 'userpass', 'CHANGE_ME', 'CHANGE_ME', NULL);
INSERT INTO ps_endpoints
 (id, transport, aors, outbound_auth, context, disallow, allow, from_domain,
  rtp_symmetric, force_rport, rewrite_contact, direct_media, set_var, tenant_id)
VALUES
 ('trunk-1', 'transport-udp', 'trunk-1', 'trunk-1', 'from-twilio',
  'all', 'ulaw,alaw', 'your-trunk.pstn.twilio.com',
  'yes','yes','yes','no', 'TRUNK=1', NULL);

-- Twilio US1 origination IP ranges (verify current list in Twilio docs).
INSERT INTO ps_endpoint_id_ips (id, endpoint, "match") VALUES
 ('trunk-1-ip1', 'trunk-1', '54.172.60.0/30'),
 ('trunk-1-ip2', 'trunk-1', '54.244.51.0/30'),
 ('trunk-1-ip3', 'trunk-1', '54.171.127.192/30'),
 ('trunk-1-ip4', 'trunk-1', '35.156.191.128/30');

-- ---- Ring group 600 (Sales) ----------------------------------------------
INSERT INTO ring_groups (tenant_id, number, name, strategy, ring_seconds, members, fail_dest_type, fail_dest_value)
 VALUES (1, '600', 'Sales', 'ringall', 20, '1001,1002', 'voicemail', '1001');

-- ---- IVR (auto-attendant) -------------------------------------------------
INSERT INTO ivr_menus (id, tenant_id, number, name, greeting, timeout, max_retries, direct_dial,
                       invalid_dest_type, invalid_dest_value, timeout_dest_type, timeout_dest_value)
 VALUES (1, 1, '500', 'Main Menu', 'custom/ivr-welcome', 5, 3, true,
         'voicemail', '1001', 'voicemail', '1001');
INSERT INTO ivr_options (ivr_id, digit, dest_type, dest_value) VALUES
 (1, '1', 'extension', '1001'),
 (1, '2', 'ringgroup', '600'),
 (1, '0', 'extension', '1001');

-- ---- Time condition 700 (business hours) ----------------------------------
INSERT INTO time_conditions (id, tenant_id, number, name, timezone,
                             match_dest_type, match_dest_value, nomatch_dest_type, nomatch_dest_value)
 VALUES (1, 1, '700', 'Business Hours', 'America/New_York',
         'ivr', '500', 'voicemail', '1001');
INSERT INTO time_ranges (time_condition_id, times, weekdays, monthdays, months)
 VALUES (1, '09:00-17:00', 'mon-fri', '*', '*');

-- ---- DID -> time condition -> IVR -----------------------------------------
INSERT INTO dids (tenant_id, number, trunk_id, description, dest_type, dest_value)
 VALUES (1, '+15550001000', 1, 'Acme main line', 'timecondition', '700');

-- ---- Outbound route: any 11-digit / E.164 number via Twilio ---------------
INSERT INTO outbound_routes (tenant_id, name, priority, pattern, regexp, trunk_id, strip_digits, prepend, caller_id)
 VALUES (1, 'US 11-digit',  100, '_1NXXNXXXXXX', '^1[2-9][0-9]{2}[2-9][0-9]{6}$', 1, 0, '+', '+15550001000'),
        (1, 'US 10-digit',  105, '_NXXNXXXXXX',  '^[2-9][0-9]{2}[2-9][0-9]{6}$',  1, 0, '+1', '+15550001000'),
        (1, 'E.164',        110, '_+X.',         '^\+[1-9][0-9]{6,15}$',          1, 0, '',  '+15550001000');

UPDATE tenants SET default_outbound_trunk_id = 1 WHERE id = 1;
