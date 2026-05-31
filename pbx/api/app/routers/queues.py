"""Call queues (ACD) — realtime app_queue. Queue name == '<slug>-<number>'."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from .. import db
from ..deps import tenant_slug

router = APIRouter(prefix="/api/tenants/{tenant_id}/queues", tags=["queues"])


class QueueIn(BaseModel):
    number: str
    name: str | None = None
    strategy: str = "rrmemory"        # ringall|leastrecent|fewestcalls|rrmemory|...
    timeout: int = 15
    retry: int = 5
    wrapuptime: int = 0
    maxlen: int = 0
    musiconhold: str = "default"
    members: list[str] = []           # agent extension numbers


class QueueMemberIn(BaseModel):
    extension: str
    penalty: int = 0


def _qname(slug: str, number: str) -> str:
    return f"{slug}-{number}"


@router.get("")
async def list_queues(ts: tuple[int, str] = Depends(tenant_slug)) -> list[dict]:
    tid, slug = ts
    rows = await db.fetch(
        "SELECT * FROM queues WHERE tenant_id=$1 ORDER BY name", tid)
    out = []
    for r in rows:
        d = dict(r)
        members = await db.fetch(
            "SELECT interface, membername, penalty, paused FROM queue_members WHERE queue_name=$1",
            d["name"])
        d["members"] = [dict(m) for m in members]
        d["number"] = d["name"].split("-", 1)[1] if "-" in d["name"] else d["name"]
        out.append(d)
    return out


@router.post("", status_code=201)
async def create_queue(body: QueueIn, ts: tuple[int, str] = Depends(tenant_slug)) -> dict:
    tid, slug = ts
    name = _qname(slug, body.number)
    try:
        await db.execute(
            """INSERT INTO queues
                 (name, musiconhold, context, timeout, retry, wrapuptime, maxlen,
                  strategy, tenant_id)
               VALUES ($1,$2,'from-internal',$3,$4,$5,$6,$7,$8)""",
            name, body.musiconhold, body.timeout, body.retry, body.wrapuptime,
            body.maxlen, body.strategy, tid,
        )
    except Exception:
        raise HTTPException(409, "queue already exists")
    for ext in body.members:
        await db.execute(
            """INSERT INTO queue_members (queue_name, interface, membername)
               VALUES ($1,$2,$3) ON CONFLICT DO NOTHING""",
            name, f"PJSIP/{slug}-{ext}", ext)
    return {"name": name}


@router.post("/{number}/members", status_code=201)
async def add_member(number: str, body: QueueMemberIn,
                     ts: tuple[int, str] = Depends(tenant_slug)) -> dict:
    tid, slug = ts
    name = _qname(slug, number)
    if not await db.fetchval("SELECT 1 FROM queues WHERE name=$1 AND tenant_id=$2", name, tid):
        raise HTTPException(404, "queue not found")
    await db.execute(
        """INSERT INTO queue_members (queue_name, interface, membername, penalty)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (queue_name, interface) DO UPDATE SET penalty=EXCLUDED.penalty""",
        name, f"PJSIP/{slug}-{body.extension}", body.extension, body.penalty)
    return {"queue": name, "member": body.extension}


@router.delete("/{number}/members/{extension}", status_code=204)
async def remove_member(number: str, extension: str,
                        ts: tuple[int, str] = Depends(tenant_slug)):
    tid, slug = ts
    await db.execute(
        "DELETE FROM queue_members WHERE queue_name=$1 AND interface=$2",
        _qname(slug, number), f"PJSIP/{slug}-{extension}")


@router.delete("/{number}", status_code=204)
async def delete_queue(number: str, ts: tuple[int, str] = Depends(tenant_slug)):
    tid, slug = ts
    name = _qname(slug, number)
    await db.execute("DELETE FROM queue_members WHERE queue_name=$1", name)
    await db.execute("DELETE FROM queues WHERE name=$1 AND tenant_id=$2", name, tid)
