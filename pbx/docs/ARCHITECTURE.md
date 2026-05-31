# Architecture & Multi-Tenancy

## Components

| Service | Role |
|---|---|
| **db** (PostgreSQL) | Single source of truth: PJSIP realtime tables, tenant/feature config, CDR. |
| **asterisk** | SIP/media engine (PJSIP). Reads endpoints/trunks/voicemail/queues *live* from the DB via ODBC realtime. |
| **api** (FastAPI) | Control plane. Provisions tenants/extensions/trunks (writes realtime rows), drives live calls via ARI/AMI. |
| **web** (React) | Admin console (super-admin + tenant admin) and WebRTC softphone. |
| **proxy** (nginx) | TLS termination; routes `/` → web, `/api` → api. |

## Why Asterisk realtime?

Instead of flat `pjsip.conf` files, endpoints/auths/AORs/contacts live in
PostgreSQL (`ps_*` tables) and are fetched on demand (sorcery + `res_config_odbc`).
That means **a new tenant or extension is usable immediately with no reload** —
essential for a hosted, API-driven, multi-tenant service. Edits to objects
already cached in memory are flushed with `pjsip reload`, which the API triggers
via AMI.

## Tenancy model

The hard problems in multi-tenant PBX are (a) globally-unique SIP identity and
(b) keeping one company's dialplan from reaching another's. We solve both
without per-tenant config files:

1. **Globally-unique endpoints.** Every phone is `ps_endpoints.id = "<slug>-<ext>"`
   (e.g. `acme-1001`), and trunks are `trunk-<id>`. SIP usernames therefore never
   collide across tenants even when two companies both use extension `1001`.

2. **Tenant carried on the channel.** Each endpoint sets channel variables on
   origination via `ps_endpoints.set_var`:
   ```
   TENANT=acme,MYEXTEN=1001
   ```
   So the moment a phone makes a call, the dialplan knows the company — no
   per-tenant context generation required. All internal lookups are scoped by
   `${TENANT}`.

3. **DID-scoped inbound.** Trunk calls land in `[from-twilio]`. The dialled
   number is looked up in `dids` (joined to `tenants`), which yields the tenant
   **and** the destination. A single shared trunk can serve every tenant.

4. **API enforcement.** Every management query is scoped by `tenant_id`, and the
   `tenant_scope` dependency rejects cross-tenant access (super-admins excepted).

## Generic destination dispatch

DIDs, IVR keys, ring-group failover and time-condition branches all point at a
`(dest_type, dest_value)` pair — exactly like 3CX's "destination" dropdowns.
The dialplan implements this with one mechanism:

```
Set(DEST_VALUE=<value>)
Goto(dispatch,<dest_type>,1)   ; dest_type is the extension name in [dispatch]
```

`[dispatch]` forwards to the right handler context (`ext-dial`, `ringgroup-exec`,
`queue-exec`, `ivr-exec`, `tc-exec`, `vm-exec`, `outbound`). This keeps routing
composable and recursive (an IVR option can point at a time condition that
points at a queue, etc.).

## Database ↔ dialplan bridge (`func_odbc`)

The dialplan reads config through named SQL functions defined in
`func_odbc.conf` (e.g. `ODBC_DID_INFO`, `ODBC_RG_INFO`, `ODBC_IVR_INFO`,
`ODBC_OUTBOUND`). Each returns a `^`-separated string that the dialplan splits
with `CUT()`. This avoids generating dialplan per tenant — the same compiled
dialplan serves everyone, parameterised by `${TENANT}`.

## Call flows

**Inbound:** Twilio → `[from-twilio]` → `ODBC_DID_INFO(did)` → set `TENANT`,
`DEST_TYPE`, `DEST_VALUE` → `dispatch` → handler.

**Internal:** phone (`from-internal`, has `TENANT`) → `internal-num` resolves
the dialled number to an extension/ring group/queue/IVR/TC within the tenant.

**Outbound:** phone dials PSTN pattern → `[outbound]` → `ODBC_OUTBOUND` picks
the best route by POSIX-regex match & priority → set caller ID → `Dial(PJSIP/<num>@trunk-<id>)`.

## Subscription plans

`plans` define `max_extensions`, `max_simultaneous_calls` and a `features` JSON
(IVR/queues/recording/SSO…). The API enforces caps (e.g. extension creation
returns HTTP 402 when a tenant hits its plan limit). Tiers map to 3CX-style
editions (Startup / Pro / Enterprise).

## Data ownership & deletion

Tenant deletion cascades feature rows and explicitly purges the tenant's
`ps_*`/`voicemail` realtime rows so no SIP identity is left dangling.
