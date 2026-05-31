"""Agent self-service: endpoints any authenticated tenant user may call to
manage *their own* extension only. Admins/super-admins can use these too, but
the value is that an `agent` (who is locked out of the company config surface)
still has a useful, safe surface: see their own status/calls, toggle DND and
call-forward, change their SIP/voicemail credentials, and click-to-call.

Resolution: a user is linked to an extension via users.extension_id. If a
user has no linked extension, these endpoints return 404 (nothing to manage).
"""
from __future__ import annotations

import os
import secrets

import httpx
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

from .. import db
from ..asterisk import hangup_channel, originate_click_to_call, pjsip_reload
from ..deps import Principal, current_user
from .recordings import resolve_recording_path

router = APIRouter(prefix="/api/me", tags=["agent-self-service"])


async def _my_extension(user: Principal) -> dict:
    """Return the caller's linked extension row (+ tenant slug), or 404."""
    if user.tenant_id is None:
        raise HTTPException(404, "no extension associated with this account")
    row = await db.fetchrow(
        """SELECT e.*, t.slug AS tenant_slug
           FROM users u
           JOIN extensions e ON e.id = u.extension_id
           JOIN tenants t ON t.id = e.tenant_id
           WHERE u.id = $1 AND e.tenant_id = $2""",
        user.user_id, user.tenant_id,
    )
    if not row:
        raise HTTPException(404, "no extension associated with this account")
    return dict(row)


class SelfPatch(BaseModel):
    dnd: bool | None = None
    call_forward: str | None = None     # "" clears it
    ring_seconds: int | None = None
    sip_password: str | None = None
    vm_pin: str | None = None
    # own notification preferences
    notify_email: str | None = None
    notify_sms: str | None = None
    notify_on_missed: bool | None = None
    notify_on_voicemail: bool | None = None
    notify_channel_email: bool | None = None
    notify_channel_sms: bool | None = None


class SelfCall(BaseModel):
    to_number: str


@router.get("")
async def whoami(user: Principal = Depends(current_user)) -> dict:
    """Profile + linked-extension summary for the signed-in user."""
    u = await db.fetchrow(
        "SELECT id, email, full_name, role, tenant_id, extension_id FROM users WHERE id=$1",
        user.user_id)
    out = dict(u) if u else {}
    try:
        ext = await _my_extension(user)
        out["extension"] = {
            "extension": ext["extension"],
            "display_name": ext["display_name"],
            "endpoint_id": ext["endpoint_id"],
            "dnd": ext["dnd"],
            "call_forward": ext["call_forward"],
            "ring_seconds": ext["ring_seconds"],
            "voicemail_enabled": ext["voicemail_enabled"],
            "webrtc": ext["webrtc"],
            "tenant_slug": ext["tenant_slug"],
            "notify_email": ext["notify_email"],
            "notify_sms": ext["notify_sms"],
            "notify_on_missed": ext["notify_on_missed"],
            "notify_on_voicemail": ext["notify_on_voicemail"],
            "notify_channel_email": ext["notify_channel_email"],
            "notify_channel_sms": ext["notify_channel_sms"],
        }
    except HTTPException:
        out["extension"] = None
    return out


@router.get("/status")
async def my_status(user: Principal = Depends(current_user)) -> dict:
    ext = await _my_extension(user)
    contact = await db.fetchrow(
        "SELECT user_agent, expiration_time FROM ps_contacts WHERE endpoint=$1",
        ext["endpoint_id"])
    return {
        "extension": ext["extension"],
        "online": contact is not None,
        "user_agent": contact["user_agent"] if contact else None,
    }


@router.patch("")
async def update_self(body: SelfPatch, user: Principal = Depends(current_user)) -> dict:
    ext = await _my_extension(user)
    tid, slug, number = ext["tenant_id"], ext["tenant_slug"], ext["extension"]

    sets, vals = [], []
    for f in ("dnd", "call_forward", "ring_seconds",
              "notify_email", "notify_sms", "notify_on_missed",
              "notify_on_voicemail", "notify_channel_email", "notify_channel_sms"):
        v = getattr(body, f)
        if v is not None:
            vals.append(v)
            sets.append(f"{f} = ${len(vals)}")
    if sets:
        vals += [tid, number]
        await db.execute(
            f"UPDATE extensions SET {', '.join(sets)} "
            f"WHERE tenant_id = ${len(vals)-1} AND extension = ${len(vals)}", *vals)
    if body.sip_password:
        await db.execute(
            "UPDATE ps_auths SET password=$1 WHERE id=$2",
            body.sip_password, ext["endpoint_id"])
        await pjsip_reload()
    if body.vm_pin is not None:
        await db.execute(
            "UPDATE voicemail SET password=$1 WHERE context=$2 AND mailbox=$3",
            body.vm_pin, slug, number)
        await db.execute(
            "UPDATE extensions SET vm_pin=$1 WHERE tenant_id=$2 AND extension=$3",
            body.vm_pin, tid, number)
    return await whoami(user)


@router.get("/calls")
async def my_calls(user: Principal = Depends(current_user), limit: int = 50) -> list[dict]:
    """The signed-in agent's own recent call history (as src or dst).

    Each row carries a `recording_id` when a recording exists for that call, so
    the portal can offer playback via /api/me/recordings/{id}/audio.
    """
    ext = await _my_extension(user)
    limit = max(1, min(limit, 200))
    rows = await db.fetch(
        """SELECT c.calldate, c.src, c.dst, c.direction, c.did, c.billsec,
                  c.disposition, r.id AS recording_id
           FROM cdr c
           LEFT JOIN recordings r ON r.uniqueid = c.uniqueid AND r.tenant_id = c.tenant_id
           WHERE c.tenant_id = $1 AND (c.src = $2 OR c.dst = $2)
           ORDER BY c.calldate DESC LIMIT $3""",
        ext["tenant_id"], ext["extension"], limit)
    return [dict(r) for r in rows]


@router.get("/recordings/{recording_id}/audio")
async def my_recording(recording_id: int, user: Principal = Depends(current_user)):
    """Stream a recording, but only if the agent's own extension was on the call."""
    ext = await _my_extension(user)
    row = await db.fetchrow(
        "SELECT path, src, dst FROM recordings WHERE id=$1 AND tenant_id=$2",
        recording_id, ext["tenant_id"])
    if not row:
        raise HTTPException(404, "recording not found")
    if ext["extension"] not in (row["src"], row["dst"]):
        raise HTTPException(403, "not a participant on this call")
    path = resolve_recording_path(ext["tenant_slug"], row["path"])
    if not os.path.exists(path):
        raise HTTPException(404, "recording file not found")
    return FileResponse(path, media_type="audio/wav",
                        filename=os.path.basename(path))


@router.post("/regenerate-sip-password")
async def regenerate_sip_password(user: Principal = Depends(current_user)) -> dict:
    """Issue a fresh SIP secret for the agent's own device."""
    ext = await _my_extension(user)
    pwd = secrets.token_urlsafe(18)
    await db.execute("UPDATE ps_auths SET password=$1 WHERE id=$2", pwd, ext["endpoint_id"])
    await pjsip_reload()
    return {"sip_username": ext["endpoint_id"], "sip_password": pwd}


@router.post("/call")
async def click_to_call(body: SelfCall, user: Principal = Depends(current_user)) -> dict:
    """Ring the agent's own phone, then dial the target (click-to-call)."""
    ext = await _my_extension(user)
    try:
        chan = await originate_click_to_call(
            slug=ext["tenant_slug"], from_ext=ext["extension"],
            to_number=body.to_number, caller_id=ext["outbound_cid"])
    except httpx.HTTPError as exc:
        raise HTTPException(502, f"ARI originate failed: {exc}")
    return {"channel": chan.get("id"), "state": chan.get("state")}


@router.delete("/call/{channel_id}", status_code=204)
async def hangup(channel_id: str, user: Principal = Depends(current_user)):
    await _my_extension(user)   # ensure the caller is a real agent
    await hangup_channel(channel_id)
