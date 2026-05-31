"""Ring groups (hunt / ring-all groups of extensions)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from .. import db
from ..deps import tenant_scope

router = APIRouter(prefix="/api/tenants/{tenant_id}/ring-groups", tags=["ring-groups"])


class RingGroupIn(BaseModel):
    number: str
    name: str | None = None
    strategy: str = "ringall"
    ring_seconds: int = 25
    members: list[str] = []           # extension numbers, in ring order
    fail_dest_type: str = "voicemail"
    fail_dest_value: str | None = None
    enabled: bool = True


def _csv(members: list[str]) -> str:
    return ",".join(m.strip() for m in members if m.strip())


@router.get("")
async def list_groups(tenant_id: int = Depends(tenant_scope)) -> list[dict]:
    rows = await db.fetch(
        "SELECT * FROM ring_groups WHERE tenant_id=$1 ORDER BY number", tenant_id)
    out = []
    for r in rows:
        d = dict(r)
        d["members"] = [m for m in (d.get("members") or "").split(",") if m]
        out.append(d)
    return out


@router.post("", status_code=201)
async def create_group(body: RingGroupIn,
                       tenant_id: int = Depends(tenant_scope)) -> dict:
    try:
        gid = await db.fetchval(
            """INSERT INTO ring_groups
                 (tenant_id, number, name, strategy, ring_seconds, members,
                  fail_dest_type, fail_dest_value, enabled)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id""",
            tenant_id, body.number, body.name, body.strategy, body.ring_seconds,
            _csv(body.members), body.fail_dest_type, body.fail_dest_value, body.enabled,
        )
    except Exception:
        raise HTTPException(409, "ring group number already exists")
    return {"id": gid}


@router.patch("/{group_id}")
async def update_group(group_id: int, body: RingGroupIn,
                       tenant_id: int = Depends(tenant_scope)) -> dict:
    res = await db.execute(
        """UPDATE ring_groups SET number=$3, name=$4, strategy=$5, ring_seconds=$6,
              members=$7, fail_dest_type=$8, fail_dest_value=$9, enabled=$10
           WHERE id=$1 AND tenant_id=$2""",
        group_id, tenant_id, body.number, body.name, body.strategy, body.ring_seconds,
        _csv(body.members), body.fail_dest_type, body.fail_dest_value, body.enabled,
    )
    if res.endswith("0"):
        raise HTTPException(404, "ring group not found")
    return {"id": group_id}


@router.delete("/{group_id}", status_code=204)
async def delete_group(group_id: int, tenant_id: int = Depends(tenant_scope)):
    await db.execute(
        "DELETE FROM ring_groups WHERE id=$1 AND tenant_id=$2", group_id, tenant_id)
