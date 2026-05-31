"""Inbound numbers (DIDs) and where they route."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from .. import db
from ..deps import tenant_scope

router = APIRouter(prefix="/api/tenants/{tenant_id}/dids", tags=["dids"])

VALID_DEST = {"extension", "ringgroup", "queue", "ivr", "voicemail",
              "timecondition", "external", "hangup"}


class DidIn(BaseModel):
    number: str                       # E.164, e.g. +13105551234
    description: str | None = None
    trunk_id: int | None = None
    dest_type: str = "extension"
    dest_value: str
    cid_name_prefix: str | None = None
    enabled: bool = True


@router.get("")
async def list_dids(tenant_id: int = Depends(tenant_scope)) -> list[dict]:
    rows = await db.fetch(
        "SELECT * FROM dids WHERE tenant_id=$1 ORDER BY number", tenant_id)
    return [dict(r) for r in rows]


@router.post("", status_code=201)
async def create_did(body: DidIn, tenant_id: int = Depends(tenant_scope)) -> dict:
    if body.dest_type not in VALID_DEST:
        raise HTTPException(422, f"dest_type must be one of {sorted(VALID_DEST)}")
    owned = await db.fetchval("SELECT tenant_id FROM dids WHERE number=$1", body.number)
    if owned is not None:
        raise HTTPException(409, "DID already assigned")
    did = await db.fetchval(
        """INSERT INTO dids
             (tenant_id, number, trunk_id, description, dest_type, dest_value,
              cid_name_prefix, enabled)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id""",
        tenant_id, body.number, body.trunk_id, body.description,
        body.dest_type, body.dest_value, body.cid_name_prefix, body.enabled,
    )
    return {"id": did}


@router.patch("/{did_id}")
async def update_did(did_id: int, body: DidIn,
                     tenant_id: int = Depends(tenant_scope)) -> dict:
    if body.dest_type not in VALID_DEST:
        raise HTTPException(422, "invalid dest_type")
    res = await db.execute(
        """UPDATE dids SET number=$3, trunk_id=$4, description=$5, dest_type=$6,
              dest_value=$7, cid_name_prefix=$8, enabled=$9
           WHERE id=$1 AND tenant_id=$2""",
        did_id, tenant_id, body.number, body.trunk_id, body.description,
        body.dest_type, body.dest_value, body.cid_name_prefix, body.enabled,
    )
    if res.endswith("0"):
        raise HTTPException(404, "DID not found")
    return {"id": did_id}


@router.delete("/{did_id}", status_code=204)
async def delete_did(did_id: int, tenant_id: int = Depends(tenant_scope)):
    await db.execute("DELETE FROM dids WHERE id=$1 AND tenant_id=$2", did_id, tenant_id)
