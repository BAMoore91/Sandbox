# Deployment Guide

## 1. Server requirements

- A Linux host (Ubuntu 22.04/24.04 or Debian 12) with a **public IP**.
- Docker Engine + Docker Compose v2.
- DNS A-record for `PUBLIC_HOSTNAME` → your public IP (needed for valid TLS
  and WebRTC).
- Open inbound firewall ports:

| Port | Proto | Purpose |
|---|---|---|
| 80, 443 | TCP | Console + API (HTTP→HTTPS) |
| 5060 | UDP/TCP | SIP signalling (trunks, desk phones) |
| 5061 | TCP | SIP over TLS |
| 8089 | TCP | Secure WebSocket (WebRTC softphone) |
| 10000–10200 | UDP | RTP media (must match `RTP_START/END`) |

> Do **not** expose 8088 (ARI/AMI HTTP) or 5038 (AMI) publicly. They are only
> reachable on the internal Docker network by design.

## 2. Configure

```bash
cd pbx
cp .env.example .env
```

Edit `.env`:
- `PUBLIC_HOSTNAME`, `PUBLIC_IP` — your FQDN and public IP.
- Strong values for `POSTGRES_PASSWORD`, `JWT_SECRET` (`openssl rand -hex 32`),
  `ARI_PASSWORD`, `AMI_PASSWORD`.
- `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD` — first super-admin.

## 3. Launch

```bash
docker compose up -d --build
docker compose ps
docker compose logs -f asterisk      # watch the engine boot
```

Migrations in `db/migrations/` run automatically on first start (empty volume).

## 4. TLS certificate (production)

The Asterisk entrypoint generates a **self-signed** cert on first boot so the
stack runs immediately. Browsers and Twilio Secure Trunking need a real cert.

Issue one with certbot and drop it into the shared `asterisk_keys` volume as
`fullchain.pem` / `privkey.pem`:

```bash
certbot certonly --standalone -d pbx.example.com
docker run --rm -v openpbx_asterisk_keys:/keys -v /etc/letsencrypt:/le alpine \
  sh -c "cp /le/live/pbx.example.com/fullchain.pem /keys/ && \
         cp /le/live/pbx.example.com/privkey.pem /keys/"
docker compose restart asterisk proxy
```

Automate renewal with a cron job that re-copies and restarts `asterisk proxy`.

## 5. Verify

```bash
curl -k https://$PUBLIC_HOSTNAME/api/health
docker compose exec asterisk asterisk -rx "pjsip show endpoints"
docker compose exec asterisk asterisk -rx "odbc show"
docker compose exec asterisk asterisk -rx "dialplan show from-internal"
```

Log in to the console, create a company, add an extension, and register the
WebRTC softphone with the credentials shown.

## 6. Backups

The data that matters lives in PostgreSQL (config + CDR) and the Asterisk spool
(voicemail/recordings):

```bash
docker compose exec db pg_dump -U openpbx openpbx > backup-$(date +%F).sql
docker run --rm -v openpbx_asterisk_spool:/spool -v "$PWD":/out alpine \
  tar czf /out/spool-$(date +%F).tgz -C /spool .
```

## 7. Scaling notes

- **Vertical first:** a single Asterisk handles thousands of registrations and
  hundreds of concurrent calls on modest hardware. Raise `RTP_END` and trunk
  `max_channels` accordingly.
- **Database:** point `POSTGRES_HOST` at a managed/replicated PostgreSQL for HA.
- **Multiple media nodes:** run additional Asterisk containers sharing the same
  realtime DB; front them with a SIP proxy/SBC (e.g. Kamailio) for registration
  distribution. The schema is already shared-state, so this is the natural next
  step for large deployments.
- **Recording storage:** mount `asterisk_spool` (or just the recordings path)
  on object storage / NFS for retention.

## 8. Common operations

```bash
# apply config edits (templates are re-rendered on container start)
docker compose restart asterisk

# reload just PJSIP / dialplan without dropping calls
docker compose exec asterisk asterisk -rx "pjsip reload"
docker compose exec asterisk asterisk -rx "dialplan reload"

# tail live SIP
docker compose exec asterisk asterisk -rx "pjsip set logger on"
```
