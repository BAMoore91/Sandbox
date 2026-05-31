"""Live wallboard: real-time calls, queues, and agent presence for a tenant.

Reads current state from Asterisk via AMI (CoreShowChannels + QueueStatus) and
filters it to the tenant by the `<slug>-…` naming convention used for
endpoints and queues. A polling SSE stream pushes refreshed snapshots so the
browser shows a live board without hammering the API.
"""
from __future__ import annotations

import asyncio
import json

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse

from .. import db
from ..asterisk import live_channels, queue_status
from ..deps import Principal, current_user, tenant_slug
from ..security import decode_token

router = APIRouter(prefix="/api/tenants/{tenant_id}/wallboard", tags=["wallboard"])


async def _snapshot(tid: int, slug: str) -> dict:
    prefix = f"{slug}-"

    # --- live calls involving this tenant's endpoints --------------------
    chans = await live_channels()
    calls: dict[str, dict] = {}
    for c in chans:
        chan = c.get("Channel", "")
        # PJSIP/<slug>-1001-0000abcd  -> belongs to tenant if it has the prefix
        is_ours = f"PJSIP/{prefix}" in chan or chan.startswith(f"PJSIP/{prefix}") \
            or c.get("Context", "").endswith(slug)
        linked = c.get("LinkedID") or c.get("Uniqueid")
        if is_ours:
            calls.setdefault(linked, {
                "id": linked,
                "caller": c.get("CallerIDNum", ""),
                "connected": c.get("ConnectedLineNum", ""),
                "state": c.get("ChannelStateDesc", ""),
                "duration": int(c.get("Duration", "0") or 0)
                if c.get("Duration", "").isdigit() else c.get("Duration", ""),
                "channel": chan,
            })

    # --- queues for this tenant -----------------------------------------
    qevents = await queue_status()
    queues: dict[str, dict] = {}
    agents: list[dict] = []
    for e in qevents:
        name = e.get("Queue", "")
        if not name.startswith(prefix):
            continue
        short = name[len(prefix):]
        ev = e.get("Event")
        if ev == "QueueParams":
            queues[short] = {
                "queue": short,
                "calls_waiting": int(e.get("Calls", "0") or 0),
                "completed": int(e.get("Completed", "0") or 0),
                "abandoned": int(e.get("Abandoned", "0") or 0),
                "hold_time": int(e.get("Holdtime", "0") or 0),
                "talk_time": int(e.get("TalkTime", "0") or 0),
                "members": 0,
            }
        elif ev == "QueueMember":
            queues.setdefault(short, {"queue": short, "members": 0})
            queues[short]["members"] = queues[short].get("members", 0) + 1
            paused = e.get("Paused") == "1"
            in_call = e.get("InCall") == "1" or e.get("Status") in ("2", "8")
            agents.append({
                "queue": short,
                "name": e.get("MemberName") or e.get("Name", ""),
                "interface": e.get("StateInterface") or e.get("Location", ""),
                "paused": paused,
                "in_call": in_call,
                "calls_taken": int(e.get("CallsTaken", "0") or 0),
            })

    # --- registration / presence summary --------------------------------
    reg = await db.fetchrow(
        """SELECT count(*) AS total,
                  count(*) FILTER (WHERE c.id IS NOT NULL) AS online
           FROM extensions e
           LEFT JOIN ps_contacts c ON c.endpoint = e.endpoint_id
           WHERE e.tenant_id = $1""", tid)

    return {
        "active_calls": list(calls.values()),
        "active_call_count": len(calls),
        "queues": list(queues.values()),
        "agents": agents,
        "extensions_online": reg["online"] if reg else 0,
        "extensions_total": reg["total"] if reg else 0,
    }


@router.get("")
async def snapshot(ts: tuple[int, str] = Depends(tenant_slug)) -> dict:
    """One-shot wallboard snapshot."""
    tid, slug = ts
    return await _snapshot(tid, slug)


@router.get("/stream")
async def stream(request: Request, tenant_id: int, access_token: str | None = None):
    """Server-Sent Events stream of wallboard snapshots (~every 3s).

    EventSource can't send Authorization headers, so the JWT is accepted as the
    `access_token` query param here and validated inline; the caller must be a
    member (or super-admin) of the tenant. Re-reads role/tenant from the DB.
    """
    if not access_token:
        raise HTTPException(401, "missing access_token")
    try:
        payload = decode_token(access_token)
    except Exception:
        raise HTTPException(401, "invalid token")
    urow = await db.fetchrow(
        "SELECT tenant_id, role, is_active FROM users WHERE id=$1",
        int(payload["sub"]))
    if not urow or not urow["is_active"]:
        raise HTTPException(401, "account disabled")
    is_super = urow["role"] == "superadmin" and urow["tenant_id"] is None
    if not is_super and urow["tenant_id"] != tenant_id:
        raise HTTPException(403, "cross-tenant access denied")
    slug = await db.fetchval("SELECT slug FROM tenants WHERE id=$1", tenant_id)
    if slug is None:
        raise HTTPException(404, "tenant not found")

    async def gen():
        while True:
            if await request.is_disconnected():
                break
            try:
                snap = await _snapshot(tenant_id, slug)
                yield f"data: {json.dumps(snap)}\n\n"
            except Exception:
                yield 'data: {"error":"snapshot failed"}\n\n'
            await asyncio.sleep(3)

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache",
                                      "X-Accel-Buffering": "no"})
