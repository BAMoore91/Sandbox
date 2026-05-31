# Customer Self-Service Portal

Each company (tenant) gets its own login to the same console at
`https://<PUBLIC_HOSTNAME>/`. Tenant admins manage **only their own** call
flow — every page is scoped to their `tenant_id` and the API rejects
cross-tenant access (HTTP 403). Platform super-admins additionally see the
**Companies** screen for provisioning/billing.

## What a customer can do

| Portal page | Controls | API |
|---|---|---|
| **Dashboard** | live extension registrations, 30-day call stats | `/status`, `/cdr/summary` |
| **Extensions** | create/edit/delete phones (SIP + WebRTC), VM, CF, DND | `/extensions` |
| **Auto-Attendant (IVR)** | greeting + per-key routing, timeout/invalid fallbacks, direct dial | `/ivrs` |
| **Ring Groups** | members, ring strategy, no-answer destination | `/ring-groups` |
| **Queues** | ACD queues, strategy, add/remove agents live | `/queues` |
| **Schedules** | business-hours time ranges + open/closed routing | `/time-conditions` |
| **Prompts** | upload/play/delete custom audio (greetings, announcements, MoH) | `/prompts` |
| **Inbound (DIDs)** | map each phone number to any destination | `/dids` |
| **Outbound Rules** | dial patterns → trunk, caller ID, digit manipulation | `/outbound-routes` |
| **Trunks** | view shared trunk / add own Twilio trunk | `/trunks` |
| **Call Logs** | filterable CDR | `/cdr` |
| **Recordings** | list / play / download / delete call recordings | `/recordings` |
| **Settings** | company name, timezone, recording on/off, data retention | `/tenants/{id}` |
| **Users & Roles** | create logins, set role, link agents to extensions | `/tenants/{id}/users` |
| **Softphone** | in-browser WebRTC phone | (SIP over WSS) |

## Call recording

Recording is a per-company toggle (Settings → Call Recording), gated by the
plan's `recording` feature flag. When on, the dialplan runs `MixMonitor` on
answered calls (via the `start-recording` subroutine), mixing both legs into:

```
/var/spool/asterisk/monitor/<tenant_slug>/<YYYY>/<MM>/<DD>/<uniqueid>.wav
```

That path is stamped into `cdr.recording` and catalogued in the `recordings`
table. The API serves audio back from the same shared volume (mounted
read-only), resolving each stored path against the tenant's own subtree and
refusing anything that escapes it (path-traversal safe). Admins manage all of
the company's recordings under **Recordings**; agents can replay recordings of
**their own** calls from their call history in **My Phone**.

## Data retention (auto-purge)

Each company sets retention windows under **Settings → Data Retention**:

- **Recordings older than N days** — deletes both the audio file (from the
  shared monitor volume) and its catalog row.
- **Call logs (CDR) older than N days** — deletes old `cdr` rows.
- **0 = keep forever** (no purge for that data type).

A background sweeper in the API (`api/app/retention.py`, started from the app
lifespan) runs once a day — `RETENTION_INTERVAL_HOURS`, or set
`RETENTION_ENABLED=false` to drive it from an external cron instead. Admins can
also **Run purge now** and see the last sweeps (counts of recordings/CDR/files
removed) on the Settings page. Every sweep is logged to `retention_runs` for
audit. Endpoints: `GET/PUT /api/tenants/{id}/retention`,
`POST /api/tenants/{id}/retention/run`, `GET …/retention/runs`.

The scheduled sweep takes a Postgres **advisory lock** (`pg_try_advisory_lock`)
before running, so when you scale the API to multiple replicas only one runs
the purge per tick and the rest skip it — no duplicated work or races. The
manual "Run purge now" endpoint doesn't take the lock (it's an explicit,
admin-initiated, single action).

File deletion reuses the same tenant-scoped path guard as playback, so a
purge can only ever touch files inside that tenant's own subtree, and it
prunes the emptied date directories afterward.

## Uploading prompts (how it works)

1. Customer uploads any common audio file (wav/mp3/m4a/ogg) on the **Prompts**
   page.
2. The API (`api/app/routers/prompts.py`) transcodes it with `ffmpeg` to the
   format Asterisk plays most reliably — **8 kHz mono PCM s16 WAV** — and writes
   it to the shared `asterisk_sounds` volume at
   `…/sounds/custom/<tenant_slug>/<name>.wav`.
3. A row is recorded in the `prompts` table with the Asterisk sound id
   `custom/<slug>/<name>` (no extension) and its duration.
4. The prompt immediately appears in the **Auto-Attendant** greeting dropdown
   (and can be used for queue announcements / music on hold). The dialplan
   plays it by that sound id with no Asterisk reload needed — Asterisk reads
   the file from disk on the next call.

Names must be lowercase dns-safe slugs (`a-z 0-9 -`). Re-uploading the same
name replaces the file. Deleting removes both the DB row and the file.

## Controlling the call flow

All routing objects share one **destination** model — a `(type, value)` pair —
so any of them can point at any other:

```
extension | ringgroup | queue | ivr | voicemail | timecondition | hangup
```

A typical inbound flow a customer can build entirely in the portal:

```
DID +1310… ─▶ Schedule "Business Hours"
                 ├─ open  ─▶ IVR 500  ─1▶ Extension 1001
                 │                     ─2▶ Ring Group 600 (Sales)
                 │                     ─3▶ Queue 800 (Support)
                 └─ closed ─▶ Voicemail 1001  (plays custom "after-hours" prompt)
```

Because endpoints, queues, voicemail and prompts are all read by Asterisk from
the database / shared volume in realtime, customer changes take effect on the
next call without restarting anything.

## Roles

| Role | Scope |
|---|---|
| `superadmin` | platform-wide: companies, plans, shared trunks |
| `admin` | full control of their own company's call flow, settings, and users |
| `agent` | self-service only: their own linked extension |

### Admin vs. agent enforcement

Authorization is enforced server-side, not just in the UI:

- The whole **configuration surface** (`/api/tenants/{id}/…` for extensions,
  IVRs, ring groups, queues, trunks, DIDs, outbound routes, prompts, schedules,
  CDR, users) goes through the `tenant_scope` dependency, which now **requires
  `admin` or `superadmin`** — an agent's token gets `403`.
- The **dashboard/status** panels use `tenant_scope_read` (membership only) so
  agents can still see live status if you choose to show it.
- Agents get a dedicated **`/api/me/*`** surface that only ever touches their
  *own* extension: profile, online status, DND, call-forward, ring time, SIP
  password regeneration, voicemail PIN, click-to-call, and personal call
  history. With no linked extension these return `404`.

The JWT only identifies the user; their role, tenant, and active flag are
re-read from the database on **every request**. So promoting/demoting a user or
disabling their account takes effect **immediately** — a disabled user's
existing token is rejected (`401`) on its next call, with no need to wait for
token expiry.

### Managing users (admin)

The portal's **Users & Roles** page (or `POST/PATCH /api/tenants/{id}/users`)
lets an admin:

- create logins as `admin` or `agent`,
- **link an agent to an extension** (by extension number — validated against
  the company), giving them the "My Phone" self-service portal,
- promote/demote roles, enable/disable, and delete logins.

### What each role sees in the web console

- **agent** → redirected to **/me** ("My Phone"): status, DND, call-forward,
  click-to-call dialer, softphone credentials, and their own call history.
  The admin console and other tenants are blocked at the router and the API.
- **admin** → the full company console (incl. Users & Roles).
- **superadmin** → also the platform **Companies** screen.
