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
| **Softphone** | in-browser WebRTC phone | (SIP over WSS) |

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
| `admin` | full control of their own company's call flow + users |
| `agent` | (extend as needed) softphone + personal settings |

Create tenant users via **Companies → users** (super-admin) or the
`/api/tenants/{id}/users` endpoint.
