# OpenPBX — Multi-Tenant Self-Hosted Phone System

A self-hosted, Linux-based, **multi-tenant** PBX that mirrors the core
capabilities of a top-tier 3CX subscription and integrates with **Twilio
Elastic SIP Trunking** out of the box. One deployment serves many companies
(tenants), each with isolated extensions, trunks, numbers, IVRs, queues and
call logs — billed per subscription plan.

> Everything runs in Docker. Asterisk is the SIP/media engine; PostgreSQL is
> the single source of truth (PJSIP **realtime** + tenant/feature data); a
> FastAPI control plane provisions tenants and drives Asterisk via ARI/AMI;
> a React console provides the admin portal and an in-browser **WebRTC
> softphone**.

```
                         ┌──────────────────────────────┐
   Browser (admin/UI) ───┤  nginx (TLS)  → web (React)   │
   WebRTC softphone ──┐   │               → api (FastAPI) │
                      │   └───────────────┬───────────────┘
                      │                   │ ARI / AMI
              wss:8089│           ┌────────▼────────┐      SIP/RTP
   PSTN  ◀── Twilio ──┼──────────▶│    Asterisk     │◀────────────▶ SIP phones
        SIP trunk     │  sip:5060 │  (PJSIP realtime)│
                      │           └────────┬────────┘
                      │                    │ ODBC realtime
                      │           ┌─────────▼────────┐
                      └──────────▶│   PostgreSQL     │
                                  └──────────────────┘
```

## Feature parity with 3CX (high tier)

| 3CX capability | OpenPBX |
|---|---|
| Multi-tenant / multi-company | ✅ native (tenant-scoped everything) |
| Subscription plans & limits | ✅ `plans` (ext caps, simultaneous calls, feature flags) |
| SIP trunk (Twilio) | ✅ Elastic SIP Trunking, credentials or IP-ACL, secure trunking |
| Extensions (SIP + WebRTC) | ✅ realtime PJSIP, browser softphone (SIP.js) |
| DIDs / inbound routing | ✅ DID → tenant → destination |
| IVR / digital receptionist | ✅ multi-level, timeout/invalid handling, direct dial |
| Ring groups | ✅ ring-all + failover destination |
| Call queues (ACD) | ✅ realtime `app_queue`, agents, strategies |
| Time-based routing | ✅ time conditions + ranges, per-tenant timezone |
| Voicemail + email | ✅ realtime mailboxes, email delivery |
| Outbound rules / caller ID | ✅ pattern routes, per-route CID, digit manipulation |
| Click-to-call | ✅ via ARI originate |
| Call reporting / CDR | ✅ per-tenant CDR + summaries |
| Call recording | ✅ hook points (MixMonitor) + `recordings` catalog |

## Quick start

```bash
cd pbx
cp .env.example .env          # then edit secrets + PUBLIC_HOSTNAME/PUBLIC_IP
docker compose up -d --build
```

- Console:        `https://<PUBLIC_HOSTNAME>/`
- API docs:       `https://<PUBLIC_HOSTNAME>/api/docs`
- Platform admin: the `BOOTSTRAP_ADMIN_*` account from `.env`
- Demo tenant:    company slug `acme` (extensions 1001/1002, IVR 500, ring group 600)

Then follow:
1. **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)** — server prep, firewall, TLS, scaling.
2. **[docs/TWILIO_SETUP.md](docs/TWILIO_SETUP.md)** — create the SIP trunk and wire DIDs.
3. **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** — how multi-tenancy & routing work.
4. **[docs/CUSTOMER_PORTAL.md](docs/CUSTOMER_PORTAL.md)** — the self-service portal:
   customers control their own call flow and upload their own audio prompts.

## Repository layout

```
pbx/
├── docker-compose.yml      # full stack
├── .env.example            # configuration
├── asterisk/               # Asterisk image, configs (realtime PJSIP), dialplan
├── db/migrations/          # PostgreSQL schema + seed (PJSIP realtime + tenant data)
├── api/                    # FastAPI management/control plane
├── web/                    # React admin console + WebRTC softphone
├── proxy/                  # nginx TLS reverse proxy
└── docs/                   # deployment / Twilio / architecture guides
```

## Security notes

- AMI (5038) and ARI (8088) are bound to the internal Docker network only —
  never expose them publicly.
- Replace the self-signed cert with a real one (Let's Encrypt) for production
  WebRTC and TLS trunking — see DEPLOYMENT.
- Tenant isolation is enforced at the API (every query is tenant-scoped) and in
  the dialplan (per-tenant context via endpoint `set_var`). Endpoint ids are
  globally unique (`<slug>-<ext>`) so SIP credentials never collide.
- Outbound caller IDs must be numbers you own on Twilio.
