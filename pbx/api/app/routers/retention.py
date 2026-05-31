"""Per-tenant data retention: configure windows, view sweep history, and run
a purge on demand. Admin-only (uses tenant_scope)."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from .. import db
from ..deps import tenant_scope
from ..retention import run_retention_once

router = APIRouter(prefix="/api/tenants/{tenant_id}/retention", tags=["retention"])


class RetentionPolicy(BaseModel):
    # 0 = keep forever
    recording_retention_days: int | None = Field(default=None, ge=0, le=3650)
    cdr_retention_days: int | None = Field(default=None, ge=0, le=3650)


@router.get("")
async def get_policy(tenant_id: int = Depends(tenant_scope)) -> dict:
    row = await db.fetchrow(
        """SELECT recording_retention_days, cdr_retention_days FROM tenants
           WHERE id = $1""", tenant_id)
    return dict(row)


@router.put("")
async def set_policy(body: RetentionPolicy,
                     tenant_id: int = Depends(tenant_scope)) -> dict:
    sets, vals = [], []
    if body.recording_retention_days is not None:
        vals.append(body.recording_retention_days)
        sets.append(f"recording_retention_days = ${len(vals)}")
    if body.cdr_retention_days is not None:
        vals.append(body.cdr_retention_days)
        sets.append(f"cdr_retention_days = ${len(vals)}")
    if sets:
        vals.append(tenant_id)
        await db.execute(
            f"UPDATE tenants SET {', '.join(sets)} WHERE id = ${len(vals)}", *vals)
    return await get_policy(tenant_id)


@router.get("/runs")
async def list_runs(tenant_id: int = Depends(tenant_scope), limit: int = 20) -> list[dict]:
    limit = max(1, min(limit, 100))
    rows = await db.fetch(
        """SELECT id, started_at, finished_at, recordings_deleted, cdr_deleted,
                  files_deleted, files_missing, error
           FROM retention_runs WHERE tenant_id = $1
           ORDER BY started_at DESC LIMIT $2""",
        tenant_id, limit)
    return [dict(r) for r in rows]


@router.post("/run")
async def run_now(tenant_id: int = Depends(tenant_scope)) -> dict:
    """Trigger an immediate retention sweep for this tenant."""
    results = await run_retention_once(tenant_id)
    return results[0] if results else {"recordings_deleted": 0, "cdr_deleted": 0}
