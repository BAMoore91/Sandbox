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


# ---------------------------------------------------------------------------
#  Holidays — closed-day overrides attached to a time condition.
#  Checked before open-hours ranges in the dialplan: a holiday forces CLOSED.
# ---------------------------------------------------------------------------
class HolidayIn(BaseModel):
    name: str
    recurring: bool = True            # same date every year
    month: int                        # 1-12
    day: int                          # 1-31
    year: int | None = None           # required when not recurring
    times: str = "*"                  # '*' all day, or HH:MM-HH:MM
    dest_type: str | None = None      # override closed dest (else TC's nomatch)
    dest_value: str | None = None
    enabled: bool = True


async def _tc_owned(tc_id: int, tenant_id: int) -> bool:
    return bool(await db.fetchval(
        "SELECT 1 FROM time_conditions WHERE id=$1 AND tenant_id=$2", tc_id, tenant_id))


@router.get("/{tc_id}/holidays")
async def list_holidays(tc_id: int, tenant_id: int = Depends(tenant_scope)) -> list[dict]:
    if not await _tc_owned(tc_id, tenant_id):
        raise HTTPException(404, "time condition not found")
    rows = await db.fetch(
        """SELECT id, name, recurring, month, day, year, times,
                  dest_type, dest_value, enabled
           FROM holidays WHERE time_condition_id=$1 ORDER BY month, day""", tc_id)
    return [dict(r) for r in rows]


def _validate_holiday(b: HolidayIn) -> None:
    if not (1 <= b.month <= 12):
        raise HTTPException(422, "month must be 1-12")
    if not (1 <= b.day <= 31):
        raise HTTPException(422, "day must be 1-31")
    if not b.recurring and not b.year:
        raise HTTPException(422, "year is required for a one-off (non-recurring) holiday")


@router.post("/{tc_id}/holidays", status_code=201)
async def create_holiday(tc_id: int, body: HolidayIn,
                         tenant_id: int = Depends(tenant_scope)) -> dict:
    if not await _tc_owned(tc_id, tenant_id):
        raise HTTPException(404, "time condition not found")
    _validate_holiday(body)
    hid = await db.fetchval(
        """INSERT INTO holidays
             (time_condition_id, tenant_id, name, recurring, month, day, year,
              times, dest_type, dest_value, enabled)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id""",
        tc_id, tenant_id, body.name, body.recurring, body.month, body.day,
        body.year, body.times, body.dest_type, body.dest_value, body.enabled)
    return {"id": hid}


@router.put("/{tc_id}/holidays/{holiday_id}")
async def update_holiday(tc_id: int, holiday_id: int, body: HolidayIn,
                         tenant_id: int = Depends(tenant_scope)) -> dict:
    _validate_holiday(body)
    res = await db.execute(
        """UPDATE holidays SET name=$4, recurring=$5, month=$6, day=$7, year=$8,
             times=$9, dest_type=$10, dest_value=$11, enabled=$12
           WHERE id=$1 AND time_condition_id=$2 AND tenant_id=$3""",
        holiday_id, tc_id, tenant_id, body.name, body.recurring, body.month,
        body.day, body.year, body.times, body.dest_type, body.dest_value, body.enabled)
    if res.endswith("0"):
        raise HTTPException(404, "holiday not found")
    return {"id": holiday_id, "status": "updated"}


@router.delete("/{tc_id}/holidays/{holiday_id}", status_code=204)
async def delete_holiday(tc_id: int, holiday_id: int,
                         tenant_id: int = Depends(tenant_scope)):
    await db.execute(
        "DELETE FROM holidays WHERE id=$1 AND time_condition_id=$2 AND tenant_id=$3",
        holiday_id, tc_id, tenant_id)
