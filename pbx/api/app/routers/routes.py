"""Outbound dial routes (pattern -> trunk + transforms)."""
from __future__ import annotations

import re

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from .. import db
from ..deps import tenant_scope

router = APIRouter(prefix="/api/tenants/{tenant_id}/outbound-routes", tags=["routes"])


def asterisk_pattern_to_regex(pattern: str) -> str:
    """Best-effort conversion of an Asterisk dial pattern to a POSIX regex.
    Supports the common tokens X N Z . ! + and literal digits/plus.
    """
    p = pattern[1:] if pattern.startswith("_") else pattern
    out = ["^"]
    for ch in p:
        if ch == "X":
            out.append("[0-9]")
        elif ch == "N":
            out.append("[2-9]")
        elif ch == "Z":
            out.append("[1-9]")
        elif ch == ".":
            out.append(".*")
        elif ch == "!":
            out.append(".*")
        elif ch == "+":
            out.append(r"\+")
        elif ch.isdigit():
            out.append(ch)
        else:
            out.append(re.escape(ch))
    out.append("$")
    return "".join(out)


class RouteIn(BaseModel):
    name: str
    pattern: str
    regexp: str | None = None        # derived from pattern if omitted
    trunk_id: int
    priority: int = 100
    strip_digits: int = 0
    prepend: str = ""
    caller_id: str | None = None
    enabled: bool = True


@router.get("")
async def list_routes(tenant_id: int = Depends(tenant_scope)) -> list[dict]:
    rows = await db.fetch(
        "SELECT * FROM outbound_routes WHERE tenant_id=$1 ORDER BY priority, id", tenant_id)
    return [dict(r) for r in rows]


@router.post("", status_code=201)
async def create_route(body: RouteIn, tenant_id: int = Depends(tenant_scope)) -> dict:
    trunk = await db.fetchval(
        "SELECT 1 FROM trunks WHERE id=$1 AND (tenant_id=$2 OR tenant_id IS NULL)",
        body.trunk_id, tenant_id)
    if not trunk:
        raise HTTPException(422, "trunk_id not available to this tenant")
    regexp = body.regexp or asterisk_pattern_to_regex(body.pattern)
    rid = await db.fetchval(
        """INSERT INTO outbound_routes
             (tenant_id, name, priority, pattern, regexp, trunk_id, strip_digits,
              prepend, caller_id, enabled)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id""",
        tenant_id, body.name, body.priority, body.pattern, regexp, body.trunk_id,
        body.strip_digits, body.prepend, body.caller_id, body.enabled,
    )
    return {"id": rid, "regexp": regexp}


@router.patch("/{route_id}")
async def update_route(route_id: int, body: RouteIn,
                       tenant_id: int = Depends(tenant_scope)) -> dict:
    regexp = body.regexp or asterisk_pattern_to_regex(body.pattern)
    res = await db.execute(
        """UPDATE outbound_routes SET name=$3, priority=$4, pattern=$5, regexp=$6,
              trunk_id=$7, strip_digits=$8, prepend=$9, caller_id=$10, enabled=$11
           WHERE id=$1 AND tenant_id=$2""",
        route_id, tenant_id, body.name, body.priority, body.pattern, regexp,
        body.trunk_id, body.strip_digits, body.prepend, body.caller_id, body.enabled,
    )
    if res.endswith("0"):
        raise HTTPException(404, "route not found")
    return {"id": route_id, "regexp": regexp}


@router.delete("/{route_id}", status_code=204)
async def delete_route(route_id: int, tenant_id: int = Depends(tenant_scope)):
    await db.execute(
        "DELETE FROM outbound_routes WHERE id=$1 AND tenant_id=$2", route_id, tenant_id)
