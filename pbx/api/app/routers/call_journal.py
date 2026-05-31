"""Call journaling — manage sinks that forward CDRs to an external DB/webhook.

Tenant admins manage their own company's sinks; super-admins can additionally
create a platform-wide sink (forwards every tenant's calls). Sink rows hold
secrets (DSN / auth header) which are masked in responses.
"""
from __future__ import annotations

import asyncpg
import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from .. import db
from ..call_journal import run_sink
from ..deps import Principal, current_user, tenant_scope

router = APIRouter(prefix="/api/tenants/{tenant_id}/call-journal", tags=["call-journal"])

VALID_TYPES = {"postgres", "webhook"}


class SinkIn(BaseModel):
    name: str
    type: str                          # postgres | webhook
    dsn: str | None = None             # postgres
    target_table: str = "pbx_cdr"
    url: str | None = None             # webhook
    auth_header: str | None = None
    batch_size: int = 200
    enabled: bool = True
    platform_wide: bool = False        # super-admin only: forward ALL tenants


def _mask(row: dict) -> dict:
    d = dict(row)
    if d.get("dsn"):
        d["dsn"] = "••• configured"
    if d.get("auth_header"):
        d["auth_header"] = "••• set"
    return d


def _validate(body: SinkIn) -> None:
    if body.type not in VALID_TYPES:
        raise HTTPException(422, f"type must be one of {sorted(VALID_TYPES)}")
    if body.type == "postgres" and not body.dsn:
        raise HTTPException(422, "postgres sink requires a dsn")
    if body.type == "webhook" and not body.url:
        raise HTTPException(422, "webhook sink requires a url")
    if not (1 <= body.batch_size <= 1000):
        raise HTTPException(422, "batch_size must be 1-1000")
    if body.target_table and not body.target_table.replace("_", "").isalnum():
        raise HTTPException(422, "target_table must be alphanumeric/underscore")


@router.get("")
async def list_sinks(tenant_id: int = Depends(tenant_scope),
                     user: Principal = Depends(current_user)) -> list[dict]:
    # a tenant sees its own sinks plus any platform-wide ones (read-only to it)
    rows = await db.fetch(
        """SELECT id, tenant_id, name, type, target_table, url, dsn, auth_header,
                  batch_size, enabled, cursor_id, last_run_at, last_status,
                  last_error, delivered_total
           FROM call_journal_sinks
           WHERE tenant_id = $1 OR tenant_id IS NULL
           ORDER BY tenant_id NULLS FIRST, id""", tenant_id)
    out = []
    for r in rows:
        d = _mask(dict(r))
        d["platform_wide"] = r["tenant_id"] is None
        d["read_only"] = r["tenant_id"] is None and not user.is_superadmin
        out.append(d)
    return out


@router.post("", status_code=201)
async def create_sink(body: SinkIn, tenant_id: int = Depends(tenant_scope),
                      user: Principal = Depends(current_user)) -> dict:
    _validate(body)
    owner = None if (body.platform_wide and user.is_superadmin) else tenant_id
    sid = await db.fetchval(
        """INSERT INTO call_journal_sinks
             (tenant_id, name, type, dsn, target_table, url, auth_header,
              batch_size, enabled)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id""",
        owner, body.name, body.type, body.dsn, body.target_table, body.url,
        body.auth_header, body.batch_size, body.enabled)
    return {"id": sid, "platform_wide": owner is None}


async def _owned_sink(sink_id: int, tenant_id: int, user: Principal) -> dict:
    row = await db.fetchrow("SELECT * FROM call_journal_sinks WHERE id=$1", sink_id)
    if not row:
        raise HTTPException(404, "sink not found")
    if row["tenant_id"] is None and not user.is_superadmin:
        raise HTTPException(403, "platform-wide sink is managed by the platform admin")
    if row["tenant_id"] is not None and row["tenant_id"] != tenant_id:
        raise HTTPException(404, "sink not found")
    return dict(row)


@router.put("/{sink_id}")
async def update_sink(sink_id: int, body: SinkIn,
                      tenant_id: int = Depends(tenant_scope),
                      user: Principal = Depends(current_user)) -> dict:
    await _owned_sink(sink_id, tenant_id, user)
    _validate(body)
    # keep existing secret if the client sends a blank (masked) value back
    await db.execute(
        """UPDATE call_journal_sinks SET name=$2, type=$3,
             dsn=COALESCE(NULLIF($4,''), dsn), target_table=$5, url=$6,
             auth_header=COALESCE(NULLIF($7,''), auth_header),
             batch_size=$8, enabled=$9, updated_at=now()
           WHERE id=$1""",
        sink_id, body.name, body.type, body.dsn, body.target_table, body.url,
        body.auth_header, body.batch_size, body.enabled)
    return {"id": sink_id, "status": "updated"}


@router.delete("/{sink_id}", status_code=204)
async def delete_sink(sink_id: int, tenant_id: int = Depends(tenant_scope),
                      user: Principal = Depends(current_user)):
    await _owned_sink(sink_id, tenant_id, user)
    await db.execute("DELETE FROM call_journal_sinks WHERE id=$1", sink_id)


@router.post("/{sink_id}/test")
async def test_sink(sink_id: int, tenant_id: int = Depends(tenant_scope),
                    user: Principal = Depends(current_user)) -> dict:
    """Check connectivity to the sink's destination (no CDRs sent)."""
    sink = await _owned_sink(sink_id, tenant_id, user)
    try:
        if sink["type"] == "postgres":
            conn = await asyncpg.connect(dsn=sink["dsn"], timeout=10)
            try:
                await conn.fetchval("SELECT 1")
            finally:
                await conn.close()
        else:
            async with httpx.AsyncClient(timeout=10) as c:
                headers = {"Authorization": sink["auth_header"]} if sink["auth_header"] else {}
                # HEAD/empty POST probe; many endpoints accept it
                r = await c.post(sink["url"],
                                 json={"source": "openpbx", "count": 0, "calls": []},
                                 headers=headers)
                if r.status_code >= 300:
                    raise RuntimeError(f"{r.status_code}: {r.text[:150]}")
    except Exception as exc:
        raise HTTPException(400, f"connection failed: {exc}")
    return {"ok": True}


@router.post("/{sink_id}/run")
async def run_now(sink_id: int, tenant_id: int = Depends(tenant_scope),
                  user: Principal = Depends(current_user)) -> dict:
    """Force a delivery pass now (forwards any unsent CDRs)."""
    sink = await _owned_sink(sink_id, tenant_id, user)
    return await run_sink(sink)


@router.get("/{sink_id}/runs")
async def list_runs(sink_id: int, tenant_id: int = Depends(tenant_scope),
                    user: Principal = Depends(current_user), limit: int = 20) -> list[dict]:
    await _owned_sink(sink_id, tenant_id, user)
    rows = await db.fetch(
        """SELECT id, started_at, finished_at, rows_sent, from_id, to_id, status, error
           FROM call_journal_runs WHERE sink_id=$1
           ORDER BY started_at DESC LIMIT $2""",
        sink_id, max(1, min(limit, 100)))
    return [dict(r) for r in rows]
