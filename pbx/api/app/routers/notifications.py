"""Notification management:

- internal enqueue endpoint used by the voicemail externnotify hook (no auth;
  must stay on the private docker network — not exposed via the public proxy);
- admin endpoints to view the outbox, per-extension prefs, send a test, and
  flush delivery on demand.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from .. import db
from ..deps import tenant_scope, tenant_slug
from ..notifications import deliver_pending, enqueue_event

# ---- Internal (unauthenticated, docker-network only) ----------------------
internal_router = APIRouter(prefix="/api/internal", tags=["internal"])


class EnqueueIn(BaseModel):
    slug: str
    extension: str
    event: str               # missed | voicemail
    caller: str | None = None
    did: str | None = None


@internal_router.post("/notify")
async def internal_notify(body: EnqueueIn) -> dict:
    if body.event not in ("missed", "voicemail"):
        raise HTTPException(422, "event must be missed|voicemail")
    n = await enqueue_event(body.slug, body.extension, body.event,
                            body.caller, body.did)
    return {"queued": n}


# ---- Admin (tenant-scoped) -------------------------------------------------
router = APIRouter(prefix="/api/tenants/{tenant_id}/notifications",
                   tags=["notifications"])


class NotifyPrefs(BaseModel):
    notify_email: str | None = None
    notify_sms: str | None = None
    notify_on_missed: bool | None = None
    notify_on_voicemail: bool | None = None
    notify_channel_email: bool | None = None
    notify_channel_sms: bool | None = None


@router.get("")
async def list_notifications(tenant_id: int = Depends(tenant_scope),
                             limit: int = 100) -> list[dict]:
    limit = max(1, min(limit, 500))
    rows = await db.fetch(
        """SELECT id, extension, event, channel, recipient, status, attempts,
                  caller, did, last_error, created_at, sent_at
           FROM notifications WHERE tenant_id=$1
           ORDER BY created_at DESC LIMIT $2""",
        tenant_id, limit)
    return [dict(r) for r in rows]


@router.get("/prefs")
async def list_prefs(tenant_id: int = Depends(tenant_scope)) -> list[dict]:
    rows = await db.fetch(
        """SELECT extension, display_name, email, notify_email, notify_sms,
                  notify_on_missed, notify_on_voicemail,
                  notify_channel_email, notify_channel_sms
           FROM extensions WHERE tenant_id=$1 ORDER BY extension""",
        tenant_id)
    return [dict(r) for r in rows]


@router.put("/prefs/{extension}")
async def set_prefs(extension: str, body: NotifyPrefs,
                    tenant_id: int = Depends(tenant_scope)) -> dict:
    sets, vals = [], []
    for f in ("notify_email", "notify_sms", "notify_on_missed",
              "notify_on_voicemail", "notify_channel_email", "notify_channel_sms"):
        v = getattr(body, f)
        if v is not None:
            vals.append(v)
            sets.append(f"{f} = ${len(vals)}")
    if not sets:
        raise HTTPException(422, "no fields to update")
    vals += [tenant_id, extension]
    res = await db.execute(
        f"UPDATE extensions SET {', '.join(sets)} "
        f"WHERE tenant_id = ${len(vals)-1} AND extension = ${len(vals)}", *vals)
    if res.endswith("0"):
        raise HTTPException(404, "extension not found")
    return {"extension": extension, "status": "updated"}


class TestIn(BaseModel):
    extension: str
    event: str = "missed"


@router.post("/test")
async def send_test(body: TestIn, ts: tuple[int, str] = Depends(tenant_slug)) -> dict:
    """Queue a test notification for an extension and flush delivery now."""
    tid, slug = ts
    if body.event not in ("missed", "voicemail"):
        raise HTTPException(422, "event must be missed|voicemail")
    n = await enqueue_event(slug, body.extension, body.event, "+15555550123", None)
    if n == 0:
        raise HTTPException(
            422, "nothing queued — check the extension has a channel enabled "
                 "with a recipient set")
    sent = await deliver_pending()
    return {"queued": n, "delivery_attempted": sent}


@router.post("/flush")
async def flush(_: int = Depends(tenant_scope)) -> dict:
    """Attempt delivery of any due notifications now (platform-wide drain)."""
    return {"delivery_attempted": await deliver_pending()}
