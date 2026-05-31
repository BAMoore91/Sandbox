"""Call Detail Records — per-tenant, filterable."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from .. import db
from ..deps import tenant_scope

router = APIRouter(prefix="/api/tenants/{tenant_id}/cdr", tags=["cdr"])


@router.get("")
async def list_cdr(
    tenant_id: int = Depends(tenant_scope),
    direction: str | None = Query(None),
    src: str | None = Query(None),
    dst: str | None = Query(None),
    limit: int = Query(100, le=1000),
    offset: int = Query(0, ge=0),
) -> dict:
    where = ["tenant_id = $1"]
    args: list = [tenant_id]
    for col, val in (("direction", direction), ("src", src), ("dst", dst)):
        if val:
            args.append(val)
            where.append(f"{col} = ${len(args)}")
    clause = " AND ".join(where)
    total = await db.fetchval(f"SELECT count(*) FROM cdr WHERE {clause}", *args)
    args += [limit, offset]
    rows = await db.fetch(
        f"""SELECT calldate, clid, src, dst, direction, did, duration, billsec,
                   disposition, uniqueid, recording
            FROM cdr WHERE {clause}
            ORDER BY calldate DESC LIMIT ${len(args)-1} OFFSET ${len(args)}""",
        *args,
    )
    return {"total": total, "items": [dict(r) for r in rows]}


@router.get("/summary")
async def summary(tenant_id: int = Depends(tenant_scope)) -> dict:
    row = await db.fetchrow(
        """SELECT
              count(*) FILTER (WHERE direction='inbound')  AS inbound,
              count(*) FILTER (WHERE direction='outbound') AS outbound,
              count(*) FILTER (WHERE direction='internal') AS internal,
              count(*) FILTER (WHERE disposition='ANSWERED') AS answered,
              coalesce(sum(billsec),0) AS total_billsec
           FROM cdr WHERE tenant_id=$1 AND calldate > now() - interval '30 days'""",
        tenant_id,
    )
    return dict(row)
