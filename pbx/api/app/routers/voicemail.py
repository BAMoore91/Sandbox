"""Voicemail box administration (PIN/email/greeting settings)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from .. import db
from ..deps import tenant_slug

router = APIRouter(prefix="/api/tenants/{tenant_id}/voicemail", tags=["voicemail"])


class MailboxPatch(BaseModel):
    password: str | None = None
    email: str | None = None
    fullname: str | None = None
    attach: bool | None = None


@router.get("")
async def list_boxes(ts: tuple[int, str] = Depends(tenant_slug)) -> list[dict]:
    tid, slug = ts
    rows = await db.fetch(
        """SELECT mailbox, fullname, email, attach FROM voicemail
           WHERE context=$1 ORDER BY mailbox""", slug)
    return [dict(r) for r in rows]


@router.patch("/{mailbox}")
async def update_box(mailbox: str, body: MailboxPatch,
                     ts: tuple[int, str] = Depends(tenant_slug)) -> dict:
    tid, slug = ts
    sets, vals = [], []
    for f in ("password", "email", "fullname"):
        v = getattr(body, f)
        if v is not None:
            vals.append(v)
            sets.append(f"{f} = ${len(vals)}")
    if body.attach is not None:
        vals.append("yes" if body.attach else "no")
        sets.append(f"attach = ${len(vals)}")
    if not sets:
        raise HTTPException(422, "nothing to update")
    vals += [slug, mailbox]
    res = await db.execute(
        f"UPDATE voicemail SET {', '.join(sets)} "
        f"WHERE context = ${len(vals)-1} AND mailbox = ${len(vals)}", *vals)
    if res.endswith("0"):
        raise HTTPException(404, "mailbox not found")
    # keep the extension's cached PIN in sync
    if body.password is not None:
        await db.execute(
            "UPDATE extensions SET vm_pin=$1 WHERE tenant_id=$2 AND extension=$3",
            body.password, tid, mailbox)
    return {"mailbox": mailbox, "status": "updated"}
