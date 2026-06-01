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

## 2. Get the code (private repo)

The repo is **private**, so the droplet needs credentials to clone it. Pick
**one** of the options below. Replace `OWNER/REPO` with your GitHub repo
(here: `bamoore91/sandbox`). The deployment branch is
`claude/linux-pbx-twilio-sip-8Keo7`.

```bash
apt-get update -y && apt-get install -y git
```

### Option A — HTTPS + a fine-grained Personal Access Token (simplest)

1. GitHub → **Settings → Developer settings → Personal access tokens →
   Fine-grained tokens → Generate new token**.
   - **Repository access:** only your repo.
   - **Permissions:** *Contents → Read-only* (that's all a clone needs).
   - Set a short expiry; copy the token (starts with `github_pat_…`).
2. On the droplet, clone with the token (it is **not** saved to disk this way):

```bash
read -rsp "Paste GitHub token: " GH_TOKEN; echo
git clone --branch claude/linux-pbx-twilio-sip-8Keo7 \
  "https://x-access-token:${GH_TOKEN}@github.com/OWNER/REPO.git" openpbx
unset GH_TOKEN
cd openpbx
```

> Using the token inline in the URL avoids caching it. If you instead want
> future `git pull`s to work without re-entering it, run
> `git config --global credential.helper store` and clone without the token in
> the URL — but that writes the token to `~/.git-credentials`, so prefer a
> deploy key (Option B) for anything long-lived.

### Option B — SSH deploy key (best for a long-lived server)

A deploy key is an SSH key tied to this one repo — no account-wide access.

```bash
ssh-keygen -t ed25519 -f ~/.ssh/openpbx_deploy -N "" -C "openpbx-droplet"
cat ~/.ssh/openpbx_deploy.pub
```

Add that public key in GitHub → your repo → **Settings → Deploy keys → Add
deploy key** (read-only; do **not** check "Allow write access"). Then:

```bash
cat >> ~/.ssh/config <<'EOF'
Host github-openpbx
  HostName github.com
  User git
  IdentityFile ~/.ssh/openpbx_deploy
  IdentitiesOnly yes
EOF
git clone --branch claude/linux-pbx-twilio-sip-8Keo7 \
  git@github-openpbx:OWNER/REPO.git openpbx
cd openpbx
```

### Option C — no git on the droplet (upload a tarball)

From your **local** machine, where the repo is already checked out:

```bash
git archive --format=tar.gz --prefix=openpbx/ \
  claude/linux-pbx-twilio-sip-8Keo7 | \
  ssh root@178.128.155.236 'mkdir -p /root && tar xzf - -C /root'
ssh root@178.128.155.236 'cd /root/openpbx && ls pbx/deploy'
```

This copies the exact branch contents with no credentials on the droplet at all.


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
git pull && docker compose up -d --build   # update (re-auths per Option A/B)
docker compose exec db pg_dump -U openpbx openpbx > backup-$(date +%F).sql
docker compose down                   # stop (data persists in volumes)
```

## Troubleshooting

- **`failed to start userland proxy for port mapping …10180…/udp: timed out`**
  → Docker's default userland-proxy can't handle the ~200-port RTP range. Fix:
  `printf '{ "userland-proxy": false }\n' > /etc/docker/daemon.json && systemctl
  restart docker`, then `docker compose up -d`. (The bootstrap script now sets
  this automatically; this is the manual fix if you hit it.)
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
