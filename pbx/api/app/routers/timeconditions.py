"""Time conditions (business-hours routing) and their time ranges."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from .. import db
from ..deps import tenant_scope

router = APIRouter(prefix="/api/tenants/{tenant_id}/time-conditions",
                   tags=["time-conditions"])


class TimeRange(BaseModel):
    times: str = "*"        # e.g. 09:00-17:00
    weekdays: str = "*"     # e.g. mon-fri
    monthdays: str = "*"
    months: str = "*"


class TimeConditionIn(BaseModel):
    number: str
    name: str | None = None
    timezone: str | None = None
    match_dest_type: str
    match_dest_value: str
    nomatch_dest_type: str
    nomatch_dest_value: str
    ranges: list[TimeRange] = []


async def _ranges(tc_id: int) -> list[dict]:
    rows = await db.fetch(
        "SELECT times, weekdays, monthdays, months FROM time_ranges WHERE time_condition_id=$1",
        tc_id)
    return [dict(r) for r in rows]


@router.get("")
async def list_tcs(tenant_id: int = Depends(tenant_scope)) -> list[dict]:
    rows = await db.fetch(
        "SELECT * FROM time_conditions WHERE tenant_id=$1 ORDER BY number", tenant_id)
    out = []
    for r in rows:
        d = dict(r)
        d["ranges"] = await _ranges(d["id"])
        out.append(d)
    return out


@router.post("", status_code=201)
async def create_tc(body: TimeConditionIn,
                    tenant_id: int = Depends(tenant_scope)) -> dict:
    async with db.tx() as con:
        async with con.transaction():
            try:
                tc_id = await con.fetchval(
                    """INSERT INTO time_conditions
                         (tenant_id, number, name, timezone, match_dest_type,
                          match_dest_value, nomatch_dest_type, nomatch_dest_value)
                       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id""",
                    tenant_id, body.number, body.name, body.timezone,
                    body.match_dest_type, body.match_dest_value,
                    body.nomatch_dest_type, body.nomatch_dest_value,
                )
            except Exception:
                raise HTTPException(409, "time condition number already exists")
            for rng in body.ranges:
                await con.execute(
                    """INSERT INTO time_ranges
                         (time_condition_id, times, weekdays, monthdays, months)
                       VALUES ($1,$2,$3,$4,$5)""",
                    tc_id, rng.times, rng.weekdays, rng.monthdays, rng.months)
    return {"id": tc_id}


@router.patch("/{tc_id}")
async def update_tc(tc_id: int, body: TimeConditionIn,
                    tenant_id: int = Depends(tenant_scope)) -> dict:
    async with db.tx() as con:
        async with con.transaction():
            res = await con.execute(
                """UPDATE time_conditions SET number=$3, name=$4, timezone=$5,
                      match_dest_type=$6, match_dest_value=$7,
                      nomatch_dest_type=$8, nomatch_dest_value=$9
                   WHERE id=$1 AND tenant_id=$2""",
                tc_id, tenant_id, body.number, body.name, body.timezone,
                body.match_dest_type, body.match_dest_value,
                body.nomatch_dest_type, body.nomatch_dest_value,
            )
            if res.endswith("0"):
                raise HTTPException(404, "time condition not found")
            await con.execute("DELETE FROM time_ranges WHERE time_condition_id=$1", tc_id)
            for rng in body.ranges:
                await con.execute(
                    """INSERT INTO time_ranges
                         (time_condition_id, times, weekdays, monthdays, months)
                       VALUES ($1,$2,$3,$4,$5)""",
                    tc_id, rng.times, rng.weekdays, rng.monthdays, rng.months)
    return {"id": tc_id}


@router.delete("/{tc_id}", status_code=204)
async def delete_tc(tc_id: int, tenant_id: int = Depends(tenant_scope)):
    await db.execute(
        "DELETE FROM time_conditions WHERE id=$1 AND tenant_id=$2", tc_id, tenant_id)
