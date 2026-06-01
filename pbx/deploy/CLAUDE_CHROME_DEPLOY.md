# Deploy OpenPBX with Claude for Chrome — runbook

**Audience:** the Claude for Chrome browser agent (or any browser-only
operator). **Goal:** deploy OpenPBX onto the DigitalOcean droplet at
**178.128.155.236**, then verify it in the browser.

---

## 0. What you (the browser agent) can and cannot do

- You operate a **web browser**. You **cannot** open an SSH/terminal app on the
  local machine.
- You **can** run shell commands on the droplet through the **DigitalOcean
  web Console** — a terminal embedded in the DO dashboard. That is the tool you
  will use for the install.
- You **can** use the OpenPBX **web console** (`https://178.128.155.236/`) for
  all post-install setup.

**Stop conditions — ask the human before continuing if:**
- You are asked to type a password/token the human has not provided.
- The DigitalOcean dashboard is not already logged in (you must not attempt to
  log into someone's cloud account).
- Any command output contains an error you cannot map to a fix in §6.

**Secrets policy:** The only secret needed is a GitHub read access token (for
the private repo). Ask the human to paste it when you reach that step; do not
invent one, and do not store it anywhere except the single clone command.

---

## 1. Open the droplet's web console

1. Go to `https://cloud.digitalocean.com/droplets`.
2. If you are **not** already logged in, **stop** and ask the human to log in.
3. Click the droplet whose public IP is **178.128.155.236**.
4. Top-right, click **Console** (also labeled "Launch Droplet Console"). A
   black terminal opens in a new panel/tab and logs you in as `root`.
5. Click inside the terminal so keystrokes go to it. Press **Enter** once; you
   should see a prompt ending in `#` (e.g. `root@openpbx:~#`). That confirms a
   root shell.

> Throughout, "run" means: type the block into this console and press Enter.
> Wait for the prompt (`#`) to return before the next block.

---

## 2. Install git

```bash
apt-get update -y && apt-get install -y git
```

Wait for the `#` prompt. Ignore "newest version" notices.

---

## 3. Clone the private repo

Ask the human for the **GitHub access token** (a fine-grained PAT with
*Contents: Read-only* on the repo `bamoore91/sandbox`). When they give it,
substitute it for `PASTE_TOKEN_HERE` in the command below and run it. The token
stays only in this one command (not saved to disk).

```bash
git clone --branch claude/linux-pbx-twilio-sip-8Keo7 \
  "https://x-access-token:PASTE_TOKEN_HERE@github.com/bamoore91/sandbox.git" openpbx
cd openpbx
```

**Verify:** run `ls pbx/deploy` — you should see
`bootstrap-droplet.sh` and `DEPLOY_DROPLET.md`. If instead you see
`fatal: Authentication failed`, the token is wrong/expired — ask the human for a
new one and re-run §3.

---

## 4. Run the one-shot installer

```bash
sudo bash pbx/deploy/bootstrap-droplet.sh
```

This installs Docker, generates `pbx/.env` with random secrets and
`PUBLIC_IP=178.128.155.236`, opens the firewall, and builds + starts everything.

- The build takes **several minutes** (it compiles the Asterisk image and the
  React app). It is normal to see lots of build output scroll by.
- **Do not run other commands while it builds.** Wait until you see the final
  banner that begins with `==> Done. OpenPBX is starting on this droplet.`
- That banner prints the **Console URL, Admin email, and Admin password.**
  **Copy all three and report them to the human** — the password is also saved
  on the droplet at `pbx/deploy/ADMIN_PASSWORD.txt`.

If the build ends with an error instead of the Done banner, see §6.

---

## 5. Verify the stack is up (in the console)

Run each and read the output:

```bash
cd ~/openpbx/pbx && docker compose ps
```
Every row should show state **running** (the `db` row may say **healthy**).
If any row says `restarting` or `exited`, wait 30 seconds and run it again —
the database initializes on first boot.

```bash
curl -k https://localhost/api/health
```
Expect JSON like `{"status":"ok","database":true,"asterisk_ari":true}`.
`asterisk_ari` may be `false` for the first ~30s while Asterisk finishes
starting; re-run until it is `true` or `database` is `true`.

---

## 6. Verify in the OpenPBX web console (browser)

1. Open a new tab to **https://178.128.155.236/**.
2. The browser will warn **"Your connection is not private"** — this is
   expected (self-signed TLS on first boot). Click **Advanced → Proceed to
   178.128.155.236 (unsafe)**. (Do **not** treat this as a real security error;
   it is the temporary self-signed certificate.)
3. You should see the OpenPBX **sign-in** page.
4. Log in with the **Admin email + password** from §4 (leave the company/slug
   field blank — this is the platform admin login; use the "Platform admin
   login" toggle if shown).
5. You should land on the **Companies** screen. Deployment is verified.

**Report to the human:** the console URL, that login succeeded, and the admin
credentials.

---

## 7. (Optional) First-run setup — only if the human asks

These are all done in the browser at `https://178.128.155.236/`:

1. **Companies → Provision a company** → fill slug, name, plan, and an admin
   email/password → **Create company**.
2. Click **Manage →** on that company to open its console.
3. **Trunks → ⚡ Auto-provision from Twilio account** → paste the company's
   Twilio Account SID + auth token → **Connect** → **Auto-provision SIP trunk**
   → **Import phone numbers**.
4. **Extensions → Add extension** for each user.
5. **Inbound (DIDs)** → point each number at an extension / IVR / flow / fax box.

Do not enter Twilio/Stripe/SMTP secrets unless the human provides them for this
step.

---

## 6b. Troubleshooting (console commands)

| Symptom | Action |
|---|---|
| `docker: command not found` after §4 | The bootstrap installs Docker; re-run `sudo bash pbx/deploy/bootstrap-droplet.sh`. |
| A service shows `exited`/`restarting` in `docker compose ps` | `docker compose logs --tail=50 <name>` (e.g. `api`, `db`, `asterisk`). Most first-boot issues are the DB still initializing — wait 1 min, then `docker compose up -d`. |
| `curl ... /api/health` refuses connection | Wait 60s (proxy/API still starting), retry. Then `docker compose logs --tail=50 proxy api`. |
| Build fails downloading packages | Transient network; re-run the bootstrap — it is idempotent and keeps the existing `.env`. |
| `Authentication failed` during clone (§3) | Token wrong/expired/lacks repo access — get a new fine-grained PAT (Contents: Read-only) and re-run §3. |
| Browser cert warning at §6 | Expected (self-signed). Proceed past it. For a trusted cert later, the human follows `pbx/deploy/DEPLOY_DROPLET.md` §5 (needs a domain). |

---

## Quick command reference (for the DO console)

```bash
# status / logs
cd ~/openpbx/pbx
docker compose ps
docker compose logs -f api          # Ctrl-C to stop
# restart everything
docker compose restart
# stop (data persists in Docker volumes) / start
docker compose down
docker compose up -d
# show the generated admin password again
cat ~/openpbx/pbx/deploy/ADMIN_PASSWORD.txt
```

**Done = ** §5 shows all services running + healthy API, and §6 shows a working
login at `https://178.128.155.236/`. Report the admin credentials and the
console URL to the human.
