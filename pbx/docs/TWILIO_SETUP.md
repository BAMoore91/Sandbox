# Twilio Elastic SIP Trunk Integration

This guide wires a Twilio Elastic SIP Trunk to OpenPBX for both **outbound**
(Termination) and **inbound** (Origination) calls. It applies whether you use
one shared platform trunk for all tenants or a dedicated trunk per tenant.

## 0. Concepts

| Twilio term | Direction | Meaning |
|---|---|---|
| **Termination** | Outbound | OpenPBX → Twilio → PSTN. You dial out. |
| **Origination** | Inbound | PSTN → Twilio → OpenPBX. Calls to your numbers. |

OpenPBX represents each Twilio trunk as a PJSIP endpoint `trunk-<id>` whose
context is `from-twilio`. Inbound calls are routed by the **dialed DID**, so a
single trunk can serve many tenants — the DID determines the tenant.

## Option A — Auto-provision (recommended)

If you'd rather not configure anything by hand, OpenPBX can build the trunk for
you from your Twilio account credentials. In the portal: **Trunks → ⚡
Auto-provision from Twilio account**.

1. **Connect** the account: enter the **Account SID** + auth token, or an API
   Key SID + secret (preferred for production). The credentials are verified
   against Twilio before being stored, and the secret is masked thereafter.
   API/CLI: `PUT /api/tenants/{id}/twilio/account`.
2. **Auto-provision SIP trunk** — OpenPBX calls Twilio's Trunking API to create:
   - an **Elastic SIP Trunk** with a `<prefix>.pstn.twilio.com` termination domain,
   - a **credential list** + credential for termination auth (generated secret),
   - an **origination URL** pointing at this PBX
     (`sip:<PUBLIC_HOSTNAME>:5060`, or `:5061;transport=tls` if secure),
   and wires the matching local trunk + PJSIP rows automatically.
   API: `POST /api/tenants/{id}/twilio/provision-trunk`.
3. **Import phone numbers** — pull the account's `IncomingPhoneNumbers` and
   create them as inbound DIDs (idempotent; re-import skips existing), and
   optionally point each Twilio number's inbound at the new trunk.
   API: `GET …/twilio/numbers`, `POST …/twilio/import-numbers`.

Credentials are stored **per tenant** (`twilio_accounts`), so each company
connects its own Twilio account. To do it manually instead, use Option B.

## Option B — Manual setup

### 1. Create the trunk in Twilio

1. Twilio Console → **Elastic SIP Trunking → Trunks → Create**.
2. Note the **Termination SIP URI**, e.g. `your-trunk.pstn.twilio.com`.

### Termination (outbound) auth — pick one
- **Credential list (recommended for dynamic IPs):** create a SIP credential
  (username + password). OpenPBX sends these on outbound INVITEs.
- **IP ACL:** add your server's public IP. No credentials needed outbound.

### Origination (inbound)
Add an **Origination URI** pointing at this server:
```
sip:<PUBLIC_IP>:5060            (UDP)
sip:<PUBLIC_IP>:5061;transport=tls   (TLS / Secure Trunking)
```
Set priority/weight to `10`/`10`. Add more URIs for HA across regions.

### Secure Trunking (optional)
Enable **Secure Trunking** on the trunk to force TLS + SRTP. Then set the
OpenPBX trunk transport to `transport-tls` and media encryption to SRTP.

## 2. Assign numbers
Buy/port numbers and assign them to the trunk (Trunk → **Numbers**). These are
the DIDs you'll map to tenants in OpenPBX.

## 3. Create the trunk in OpenPBX

Console → company → **Trunks → Add Twilio trunk**, or via API:

```bash
curl -X POST https://$HOST/api/tenants/$TID/trunks \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{
    "name": "Twilio Main",
    "sip_server": "your-trunk.pstn.twilio.com",
    "transport": "transport-udp",
    "auth_mode": "credentials",
    "username": "YOUR_TWILIO_CRED_USER",
    "secret": "YOUR_TWILIO_CRED_PASS",
    "from_domain": "your-trunk.pstn.twilio.com",
    "codecs": "ulaw,alaw"
  }'
```

OpenPBX automatically allow-lists Twilio's Origination IP ranges for inbound
identification (`TWILIO_ORIGINATION_CIDRS` in `api/app/routers/trunks.py`).
**Verify the current ranges** against Twilio's docs and adjust if needed.

A shared platform trunk (super-admin) uses `"shared": true`.

## 4. Map a DID to a destination

```bash
curl -X POST https://$HOST/api/tenants/$TID/dids \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{ "number": "+13105551234", "dest_type": "ivr", "dest_value": "500" }'
```

`dest_type` ∈ `extension | ringgroup | queue | ivr | voicemail |
timecondition | hangup`.

## 5. Outbound caller ID

Twilio requires the `From` to be a number you own. Set it per outbound route
(`caller_id`) or per extension (`outbound_cid`). The seed route presents
`+15550001000` — change it to one of your Twilio numbers.

## 6. Test

- **Inbound:** call your Twilio number → should hit the mapped destination.
  Watch `docker compose logs -f asterisk`.
- **Outbound:** from a registered extension dial a real number. Confirm in
  Twilio Console → Trunk → **Calls**.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Inbound 401/404 from Asterisk | DID not in `dids`, or Twilio IP not in identify list |
| Outbound 403 from Twilio | Wrong termination credentials, or `From` not Twilio-owned |
| One-way / no audio | RTP ports `10000-10200/udp` not open, or `PUBLIC_IP` wrong |
| TLS trunk fails | cert/SNI mismatch; use a real cert matching `PUBLIC_HOSTNAME` |

Useful CLI:
```bash
docker compose exec asterisk asterisk -rx "pjsip show endpoints"
docker compose exec asterisk asterisk -rx "pjsip set logger on"
```
