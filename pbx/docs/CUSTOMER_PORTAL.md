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
| **Notifications** | per-extension missed-call/voicemail email & SMS alerts + outbox | `/tenants/{id}/notifications` |
| **Billing & Usage** | metered usage + monthly invoice, CSV export, finalize, Stripe charge, auto-bill | `/tenants/{id}/billing` |
| **Wallboard** | live calls, queue stats, agent presence (SSE) | `/tenants/{id}/wallboard` |
| **Phones** | register desk phones by MAC, auto-provision, BLF keys | `/tenants/{id}/devices` |
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

## Missed-call & voicemail notifications

Each extension can be alerted by **email** and/or **SMS** on a missed call or
a new voicemail. Preferences are per-extension (admins set them under
**Notifications**; agents manage their own under **My Phone → Notifications**):
events to alert on (missed / voicemail), which channels are enabled, and the
email address / mobile number to use (email defaults to the account email).

How it flows:

1. **Enqueue.** On an unanswered call the dialplan calls `ODBC_NOTIFY(...)`,
   which fans out one `notifications` outbox row per enabled channel for the
   extension (honoring its prefs). New voicemail is enqueued by the voicemail
   `externnotify` hook (`asterisk/scripts/vm-notify.sh`) — which fires exactly
   when a message is stored — posting to the API's internal enqueue endpoint.
2. **Deliver.** A background worker (`api/app/notifications.py`) drains pending
   rows every `NOTIFY_POLL_SECONDS`, sending email via SMTP and SMS via the
   Twilio REST API, with capped exponential-backoff retries
   (`NOTIFY_MAX_ATTEMPTS`). A failed/un-configured channel is retried and
   surfaced with its last error in the outbox; the other channel is unaffected.
3. **Digest / rate-limiting.** Within one drain, due alerts are grouped by
   channel + recipient; any group of `NOTIFY_DIGEST_THRESHOLD`+ is coalesced
   into a single digest message (e.g. "4 missed calls for 1001" listing each)
   instead of sending one message per event — so a burst never blasts a phone
   or inbox. Smaller groups send individually.
4. **Multi-replica safe.** The worker holds a Postgres advisory lock, so only
   one API replica delivers at a time (others still enqueue).

Configure SMTP and/or Twilio in `.env` (`SMTP_*`, `TWILIO_*`). Leaving a
channel's settings empty simply skips that channel. SMS reuses your Twilio
account but is independent of SIP trunking; `TWILIO_SMS_FROM` may be an E.164
number or a Messaging Service SID.

The internal enqueue endpoint (`/api/internal/notify`) is **unauthenticated by
design** and only reachable on the private Docker network — the public nginx
proxy returns 404 for `/api/internal/`.

Admins can fire a **Test** from the Notifications page to queue and immediately
attempt a sample alert for any extension.

## Usage metering & billing

Invoices are computed on demand from CDR + the tenant's plan — no separate
metering pipeline to drift out of sync. A plan carries a monthly base fee, an
optional per-extension fee, per-minute outbound/inbound rates, and a pool of
included minutes. For a period an invoice is:

```
  base monthly fee
+ per-extension fee × current extensions
+ (outbound minutes − included pool) × outbound rate
+ inbound minutes × inbound rate          (if the plan meters inbound)
```

Each call's minutes are its `billsec` rounded **up** to whole minutes (standard
telecom rounding); internal calls are free.

- **Admins** (`/tenants/{id}/billing`): pick a month, see metered usage and the
  itemized invoice, **download CSV**, or **finalize** a snapshot into the
  `invoices` table (idempotent per period).
- **Super-admins** (`/api/billing/run`, Platform Billing page): a billing run
  across every active tenant for a month, with a grand total and CSV export for
  handing to your accounting/payment system.

Endpoints: `GET …/billing/usage`, `GET …/billing/invoice[?format=csv]`,
`POST …/billing/invoice/finalize`, `GET …/billing/invoices`,
`GET /api/billing/run[?format=csv]` (super-admin).

## Payments (Stripe) & auto-billing

When `STRIPE_SECRET_KEY` is set, finalized invoices can be charged:

- A tenant gets a Stripe **Customer** lazily (on first charge or when auto-bill
  is enabled); its id is stored on the tenant.
- **Charge** (admin, per invoice) creates a confirmed off-session
  **PaymentIntent** with an idempotency key of `inv-<id>-<amount>` so retries
  never double-charge. Success → invoice `paid`; decline → `failed` with the
  reason surfaced in the UI. Zero-total invoices are marked paid without a
  charge.
- **Auto-bill** (per tenant): a monthly **scheduler** wakes every
  `BILLING_CHECK_HOURS` and, on `BILLING_RUN_DAY`, snapshots the *previous*
  month's invoices for all active tenants and charges those with auto-bill on.
  It's **advisory-locked** (multi-replica safe) and guarded so it runs at most
  once per period. Super-admins can also trigger it from Platform Billing, and
  every run is recorded in `billing_runs`.
- **Webhook** (`POST /api/billing/webhook`): Stripe `payment_intent.succeeded`
  / `…payment_failed` events reconcile invoice status. Signature-verified
  against `STRIPE_WEBHOOK_SECRET` (timestamp-checked to blunt replay). Point
  Stripe at it over TLS; leave it internal otherwise.

With Stripe unset, everything above is inert: invoices finalize and stay
`open`, and the charge button is hidden.

## Live wallboard

`/tenants/{id}/wallboard` shows a real-time operations board — active calls,
per-queue waiting/handled/abandoned counts, and agent presence
(available / on-call / paused) — built from Asterisk **AMI**
(`CoreShowChannels` + `QueueStatus`), filtered to the tenant by the
`<slug>-…` naming convention. The browser subscribes to an **SSE** stream
(`/wallboard/stream`, ~3s snapshots; nginx buffering disabled for it) and falls
back to polling if the stream drops. Because EventSource can't set headers, the
stream authenticates via an `access_token` query param, validated inline with
the same membership rules as the rest of the tenant API.

## Flows (Studio-style call flows)

Flows are a JSON graph of **widgets** executed per call by an ARI **Stasis**
app the API hosts. Point a phone number (or any destination) at a flow
(`dest_type=flow`) to run it. Widget types:

| Widget | Does | Exits |
|---|---|---|
| `say` | play TTS / a prompt | `next` |
| `gather` | collect DTMF into a variable | per-digit `transitions` + `default` |
| `record` | capture caller audio, optional transcription | `next` |
| `http` | GET/POST **webhook**; capture JSON response into vars | `success` / `failure` |
| `branch` | route on a variable's value | `cases` + `default` |
| `dial` | call an extension/number | `answered` / `noanswer` |
| `route` | hand off to the dialplan dispatcher (queue/ext/vm/IVR…) | terminal |
| `hangup` | end the call | terminal |

**Variables & templating.** Each execution starts with `caller`, `did`,
`tenant`, and accumulates whatever `gather`/`record`/`http` capture. Any
`text`, `url`, header, or body supports `{{var}}` / `{{a.b}}` placeholders, so a
webhook can post the caller's number and a later `say` can read back a value
the webhook returned.

**Webhooks (GET & POST).** An `http` widget calls an external URL; POST can send
a templated JSON body. Response fields are captured via
`save: {var: "json.path"}` (dotted paths into the JSON), and the HTTP status is
exposed as `last_status`; `success`/`failure` branch on the status code. Every
call is recorded in `flow_webhook_log`.

**Voice capture + transcription.** A `record` widget saves a WAV (under the
recordings volume) and, if `transcribe:true` and `TRANSCRIPTION_PROVIDER` is set
(e.g. OpenAI Whisper), stores the transcript on `flow_recordings`. With no
provider, the recording is saved and marked `disabled`.

**Editing & testing.** The **Flows** page edits the JSON graph with live
**Validate** (catches dangling widget references, bad types, missing URLs) and a
**Test run** that executes the flow with scripted key presses against a
simulated channel — **webhooks fire for real** during a test, so GET/POST
integrations can be verified before going live. Execution history, the path
taken, captured recordings/transcripts, and webhook logs are queryable per flow.

The engine is driver-abstracted (`api/app/flow_engine.py`) and unit-tested
(`api/tests/test_flow_engine.py`); the ARI driver (`flow_ari.py`) supplies the
media actions in production.

## Auto phone provisioning & BLF keys

Physical desk phones are zero-touch provisioned by MAC:

1. **Register** a phone under **Phones**: MAC, vendor (Yealink/Grandstream),
   the extension it should log in as, and an optional per-device token.
2. Point the phone's provisioning server at
   `https://<host>/api/provision/` (DHCP option 66, or the vendor's RPS/redirect
   service). On boot the phone GETs its config:
   - Yealink → `/api/provision/<mac>.cfg`
   - Grandstream → `/api/provision/cfg<mac>.xml`
3. The API returns a rendered config containing the SIP account (auth name,
   password, server, transport) **and** the phone's programmable keys, and
   records `last_seen`. The endpoint is unauthenticated (phones can't log in)
   but guarded by the optional device token in the URL — serve it over TLS on
   the network the phones live on.

**BLF / programmable keys** are set per extension under Phones → *Keys*
(`PUT /tenants/{id}/extensions/{ext}/keys`): BLF (busy-lamp presence),
speed-dial, or line keys. They render into each vendor's key parameters
(`linekey.N.*` for Yealink, VPK `Pxxx` for Grandstream).

For BLF presence to work, monitored extensions need dialplan **hints**. OpenPBX
generates a per-tenant context `tenant-<slug>` (in the shared dialplan volume,
`#include`d by `extensions.conf`) that `include`s `from-internal` and declares
`exten => <n>,hint,PJSIP/<slug>-<n>` for every extension; endpoints live in
that context with `allow_subscribe=yes`. The file is regenerated and
`dialplan reload`ed automatically whenever an extension is added or removed, so
BLF keys light up without manual dialplan editing. Hints are tenant-scoped, so
extension numbers never collide between companies.

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

### Generating prompts with AI (text-to-speech)

Instead of recording/uploading audio, customers can **type the script and let
AI speak it**. On the **Prompts** page, "✨ Generate with AI" takes a name, a
voice, and the text; the API (`POST …/prompts/generate`) sends the text to a
text-to-speech engine, gets back spoken audio, and runs it through the **exact
same transcode-and-store pipeline as an upload** (`_store_prompt`). So an
AI-generated prompt becomes a normal `custom/<slug>/<name>` sound — immediately
usable **anywhere a prompt is referenced**: the digital receptionist (IVR)
greeting, a flow `say` widget (set its `prompt` to the sound id), voicemail
greetings, queue announcements, and music on hold.

> Note on Whisper vs. TTS: *Whisper* is speech-to-**text** (used by flow
> `record` transcription, `TRANSCRIPTION_PROVIDER`). Generating a prompt from
> typed text is the reverse — **text-to-speech** — configured separately with
> `TTS_PROVIDER` (e.g. OpenAI's speech API; voices alloy/echo/fable/onyx/nova/
> shimmer). `GET …/prompts/tts/status` reports whether it's enabled and lists
> the voices; with no provider configured the generate button is disabled and
> uploads still work.

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
