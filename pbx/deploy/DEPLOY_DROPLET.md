# Deploy OpenPBX on the DigitalOcean droplet (178.128.155.236)

Step-by-step install instructions. These are written so a person — or an
assistant with shell access to the droplet (e.g. a Claude session that can run
a terminal) — can copy-paste and deploy. The browser-only Claude Chrome
extension can drive the **web console** after deploy, but the install itself
needs a shell on the droplet over SSH.

> Droplet: **178.128.155.236** · OS: Ubuntu 22.04/24.04 · run everything as root
> (or with `sudo`).

---

## 1. Connect to the droplet

```bash
ssh root@178.128.155.236
```

## 2. Get the code

```bash
apt-get update -y && apt-get install -y git
git clone <YOUR_REPO_URL> openpbx
cd openpbx
# use the deployment branch:
git checkout claude/linux-pbx-twilio-sip-8Keo7
```

## 3. One-shot bootstrap

```bash
sudo bash pbx/deploy/bootstrap-droplet.sh
```

This installs Docker, writes `pbx/.env` (with strong random secrets and
`PUBLIC_IP=178.128.155.236`), opens the firewall, builds the images, and starts
everything. First build takes a few minutes (it compiles the Asterisk image and
the React app). When it finishes it prints the **admin email + password** — save
them. The password is also written to `pbx/deploy/ADMIN_PASSWORD.txt`.

### Optional: use a real domain instead of the bare IP
If you have DNS, point an A record at `178.128.155.236`, then run:
```bash
PUBLIC_HOSTNAME=pbx.yourdomain.com sudo -E bash pbx/deploy/bootstrap-droplet.sh
```

## 4. Verify it's up

```bash
cd pbx
docker compose ps                 # all services should be "running"/"healthy"
curl -k https://localhost/api/health
docker compose logs -f asterisk api   # Ctrl-C to stop tailing
```

Then open the console in a browser:

- **https://178.128.155.236/**  (accept the self-signed cert warning for now)
- API docs: **https://178.128.155.236/api/docs**

Log in with the bootstrap admin email/password from step 3.

## 5. (Recommended) Real TLS certificate

The droplet boots with a **self-signed** cert, so browsers warn and the WebRTC
softphone / Twilio TLS trunking won't fully work until you install a real one.
With a domain pointed at the droplet:

```bash
apt-get install -y certbot
certbot certonly --standalone -d pbx.yourdomain.com   # briefly frees :80
docker run --rm -v openpbx_asterisk_keys:/keys -v /etc/letsencrypt:/le alpine \
  sh -c "cp /le/live/pbx.yourdomain.com/fullchain.pem /keys/ && \
         cp /le/live/pbx.yourdomain.com/privkey.pem /keys/"
docker compose restart asterisk proxy
```

(Full TLS + renewal details: `pbx/docs/DEPLOYMENT.md` §4.)

## 6. First-run setup in the console

1. Sign in as the platform admin.
2. **Companies → Provision a company** (creates a tenant + its admin).
3. **Trunks → ⚡ Auto-provision from Twilio account** — paste the company's
   Twilio Account SID + auth token (or API key), then **Auto-provision SIP
   trunk** and **Import phone numbers**. (Manual trunk setup also available.)
4. Add extensions, then point a DID at an IVR / flow / schedule / fax box.

Twilio specifics: `pbx/docs/TWILIO_SETUP.md`. Everything customers can self-serve
is in `pbx/docs/CUSTOMER_PORTAL.md`.

---

## Firewall (what the bootstrap opens)

| Port | Proto | Purpose |
|---|---|---|
| 22 | TCP | SSH (left open) |
| 80, 443 | TCP | Console + API |
| 5060 | TCP/UDP | SIP signalling |
| 5061 | TCP | SIP over TLS |
| 8089 | TCP | WebRTC secure WebSocket |
| 10000–10200 | UDP | RTP media |
| 4000–4999 | UDP | T.38 fax (UDPTL) |

`8088` (ARI) is bound to **localhost only** and `5038` (AMI) stays on the
internal Docker network — never exposed publicly.

> If you use the **DigitalOcean cloud firewall** instead of UFW, add the same
> inbound rules there.

## Day-2 operations

```bash
cd ~/openpbx/pbx
docker compose ps                     # status
docker compose logs -f api            # logs
docker compose pull && docker compose up -d --build   # update after git pull
docker compose exec db pg_dump -U openpbx openpbx > backup-$(date +%F).sql
docker compose down                   # stop (data persists in volumes)
```

## Troubleshooting

- **Browser cert warning** → expected on the self-signed cert; install a real
  one (step 5).
- **No audio / one-way audio** → confirm `PUBLIC_IP=178.128.155.236` in
  `pbx/.env` and that UDP 10000–10200 is open at *both* UFW and the DO cloud
  firewall.
- **Inbound calls don't arrive** → in Twilio, the trunk's Origination URI must
  point at `sip:178.128.155.236:5060` (auto-provision does this for you), and
  the DID must be mapped to a destination in the portal.
- **API unhealthy** → `docker compose logs api db`; usually the DB volume is
  still initializing on first boot — give it a minute.
