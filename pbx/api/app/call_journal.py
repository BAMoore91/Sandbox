"""Call journaling — reliably forward every CDR to an external destination.

A *sink* (external PostgreSQL or HTTP webhook), scoped to one tenant or
platform-wide, receives every new CDR row. Delivery uses an append-only cursor:
``cdr.id`` is monotonic, so each sink remembers the highest id it has confirmed
delivered and the worker forwards ``id > cursor`` in id order, advancing the
cursor only for rows the destination accepted. A failure just retries from the
cursor — no loss, no duplicates (idempotent on the cdr id).

The forwarding logic is split so the row-selection, payload-shaping and
cursor-advance are unit-testable with an injected "deliver" function; the
Postgres/webhook delivery functions are the production drivers.
"""
from __future__ import annotations

import asyncio
import datetime as dt
import json

import asyncpg
import httpx

from . import db
from .config import settings

# Columns forwarded for each call (kept stable so external schemas don't drift).
CDR_COLUMNS = [
    "id", "calldate", "clid", "src", "dst", "dcontext", "channel", "dstchannel",
    "lastapp", "lastdata", "duration", "billsec", "disposition", "accountcode",
    "uniqueid", "userfield", "tenant_id", "did", "direction", "recording",
]


def _row_to_dict(row) -> dict:
    d = dict(row)
    # JSON-serializable timestamps for webhook payloads.
    cd = d.get("calldate")
    if isinstance(cd, (dt.datetime, dt.date)):
        d["calldate"] = cd.isoformat()
    return d


async def fetch_unsent(sink: dict) -> list[dict]:
    """CDR rows newer than the sink's cursor, scoped to its tenant (or all)."""
    cols = ", ".join(CDR_COLUMNS)
    if sink["tenant_id"] is None:
        rows = await db.fetch(
            f"SELECT {cols} FROM cdr WHERE id > $1 ORDER BY id LIMIT $2",
            sink["cursor_id"], sink["batch_size"])
    else:
        rows = await db.fetch(
            f"SELECT {cols} FROM cdr WHERE id > $1 AND tenant_id = $2 "
            f"ORDER BY id LIMIT $3",
            sink["cursor_id"], sink["tenant_id"], sink["batch_size"])
    return [_row_to_dict(r) for r in rows]


# ---------------------------------------------------------------------------
#  Delivery drivers
# ---------------------------------------------------------------------------
async def deliver_postgres(sink: dict, rows: list[dict]) -> None:
    """INSERT the batch into an external PostgreSQL table. Idempotent on id
    (ON CONFLICT (id) DO NOTHING) so re-delivery after a partial failure is
    safe. The target table is created if missing."""
    table = sink["target_table"]
    if not table.replace("_", "").isalnum():
        raise ValueError("invalid target_table")
    conn = await asyncpg.connect(dsn=sink["dsn"], timeout=15)
    try:
        await conn.execute(f"""
            CREATE TABLE IF NOT EXISTS {table} (
                id bigint PRIMARY KEY, calldate timestamptz, clid text, src text,
                dst text, dcontext text, channel text, dstchannel text, lastapp text,
                lastdata text, duration integer, billsec integer, disposition text,
                accountcode text, uniqueid text, userfield text, tenant_id integer,
                did text, direction text, recording text,
                journaled_at timestamptz NOT NULL DEFAULT now())""")
        placeholders = ", ".join(f"${i+1}" for i in range(len(CDR_COLUMNS)))
        insert = (f"INSERT INTO {table} ({', '.join(CDR_COLUMNS)}) "
                  f"VALUES ({placeholders}) ON CONFLICT (id) DO NOTHING")
        async with conn.transaction():
            for r in rows:
                # calldate may be an iso string (from _row_to_dict) — give asyncpg a datetime
                vals = []
                for c in CDR_COLUMNS:
                    v = r[c]
                    if c == "calldate" and isinstance(v, str):
                        v = dt.datetime.fromisoformat(v)
                    vals.append(v)
                await conn.execute(insert, *vals)
    finally:
        await conn.close()


async def deliver_webhook(sink: dict, rows: list[dict]) -> None:
    """POST the batch as JSON to the sink URL. Must return 2xx."""
    headers = {"Content-Type": "application/json"}
    if sink.get("auth_header"):
        headers["Authorization"] = sink["auth_header"]
    payload = {"source": "openpbx", "count": len(rows), "calls": rows}
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(sink["url"], content=json.dumps(payload), headers=headers)
    if r.status_code >= 300:
        raise RuntimeError(f"webhook {r.status_code}: {r.text[:200]}")


def _driver(sink: dict):
    if sink["type"] == "postgres":
        return deliver_postgres
    if sink["type"] == "webhook":
        return deliver_webhook
    raise ValueError(f"unknown sink type '{sink['type']}'")


# ---------------------------------------------------------------------------
#  One delivery pass for a sink (testable with an injected deliver fn)
# ---------------------------------------------------------------------------
async def run_sink(sink: dict, deliver=None) -> dict:
    """Forward all currently-unsent CDRs for one sink, advancing the cursor in
    batches. Returns a summary; records a call_journal_runs row."""
    deliver = deliver or _driver(sink)
    run_id = await db.fetchval(
        "INSERT INTO call_journal_runs (sink_id, from_id) VALUES ($1,$2) RETURNING id",
        sink["id"], sink["cursor_id"])
    total = 0
    last_id = sink["cursor_id"]
    status, error = "ok", None
    try:
        while True:
            sink = {**sink, "cursor_id": last_id}
            rows = await fetch_unsent(sink)
            if not rows:
                break
            await deliver(sink, rows)
            last_id = rows[-1]["id"]
            total += len(rows)
            # advance the durable cursor only after the batch is accepted
            await db.execute(
                """UPDATE call_journal_sinks
                   SET cursor_id=$2, delivered_total=delivered_total+$3,
                       updated_at=now() WHERE id=$1""",
                sink["id"], last_id, len(rows))
            if len(rows) < sink["batch_size"]:
                break
    except Exception as exc:
        status, error = "error", str(exc)[:500]
    await db.execute(
        """UPDATE call_journal_sinks SET last_run_at=now(), last_status=$2,
             last_error=$3, updated_at=now() WHERE id=$1""",
        sink["id"], status, error)
    await db.execute(
        """UPDATE call_journal_runs SET finished_at=now(), rows_sent=$2,
             to_id=$3, status=$4, error=$5 WHERE id=$1""",
        run_id, total, last_id, status, error)
    return {"sink_id": sink["id"], "rows_sent": total, "to_id": last_id,
            "status": status, "error": error}


async def run_all_sinks() -> list[dict]:
    sinks = await db.fetch("SELECT * FROM call_journal_sinks WHERE enabled")
    out = []
    for s in sinks:
        try:
            out.append(await run_sink(dict(s)))
        except Exception:
            pass  # one bad sink never blocks the others
    return out


async def journal_worker(stop) -> None:
    """Background loop: forward CDRs to all enabled sinks on an interval."""
    interval = settings.call_journal_interval_seconds
    while not stop.is_set():
        try:
            await run_all_sinks()
        except Exception:
            pass
        try:
            await asyncio.wait_for(stop.wait(), timeout=interval)
        except asyncio.TimeoutError:
            continue
