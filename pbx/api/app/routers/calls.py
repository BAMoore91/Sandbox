"""Live call control via ARI: click-to-call + hangup."""
from __future__ import annotations

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from .. import db
from ..asterisk import hangup_channel, originate_click_to_call
from ..deps import tenant_slug

router = APIRouter(prefix="/api/tenants/{tenant_id}/calls", tags=["calls"])


class OriginateIn(BaseModel):
    from_extension: str
    to_number: str


@router.post("/originate")
async def originate(body: OriginateIn,
                    ts: tuple[int, str] = Depends(tenant_slug)) -> dict:
    tid, slug = ts
    ext = await db.fetchrow(
        "SELECT outbound_cid FROM extensions WHERE tenant_id=$1 AND extension=$2",
        tid, body.from_extension)
    if not ext:
        raise HTTPException(404, "extension not found")
    try:
        chan = await originate_click_to_call(
            slug=slug, from_ext=body.from_extension,
            to_number=body.to_number, caller_id=ext["outbound_cid"],
        )
    except httpx.HTTPError as exc:
        raise HTTPException(502, f"ARI originate failed: {exc}")
    return {"channel": chan.get("id"), "state": chan.get("state")}


@router.delete("/{channel_id}", status_code=204)
async def hangup(channel_id: str, ts: tuple[int, str] = Depends(tenant_slug)):
    await hangup_channel(channel_id)
