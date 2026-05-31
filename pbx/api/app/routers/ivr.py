"""IVR / auto-attendant menus and their digit options."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from .. import db
from ..deps import tenant_scope

router = APIRouter(prefix="/api/tenants/{tenant_id}/ivrs", tags=["ivr"])


class IvrOption(BaseModel):
    digit: str
    dest_type: str
    dest_value: str


class IvrIn(BaseModel):
    number: str
    name: str | None = None
    greeting: str = "custom/ivr-welcome"
    timeout: int = 5
    max_retries: int = 3
    direct_dial: bool = True
    invalid_dest_type: str = "hangup"
    invalid_dest_value: str | None = None
    timeout_dest_type: str = "hangup"
    timeout_dest_value: str | None = None
    options: list[IvrOption] = []


async def _options(ivr_id: int) -> list[dict]:
    rows = await db.fetch(
        "SELECT digit, dest_type, dest_value FROM ivr_options WHERE ivr_id=$1 ORDER BY digit",
        ivr_id)
    return [dict(r) for r in rows]


@router.get("")
async def list_ivrs(tenant_id: int = Depends(tenant_scope)) -> list[dict]:
    rows = await db.fetch(
        "SELECT * FROM ivr_menus WHERE tenant_id=$1 ORDER BY number", tenant_id)
    out = []
    for r in rows:
        d = dict(r)
        d["options"] = await _options(d["id"])
        out.append(d)
    return out


@router.post("", status_code=201)
async def create_ivr(body: IvrIn, tenant_id: int = Depends(tenant_scope)) -> dict:
    async with db.tx() as con:
        async with con.transaction():
            try:
                ivr_id = await con.fetchval(
                    """INSERT INTO ivr_menus
                         (tenant_id, number, name, greeting, timeout, max_retries,
                          direct_dial, invalid_dest_type, invalid_dest_value,
                          timeout_dest_type, timeout_dest_value)
                       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id""",
                    tenant_id, body.number, body.name, body.greeting, body.timeout,
                    body.max_retries, body.direct_dial, body.invalid_dest_type,
                    body.invalid_dest_value, body.timeout_dest_type, body.timeout_dest_value,
                )
            except Exception:
                raise HTTPException(409, "IVR number already exists")
            for opt in body.options:
                await con.execute(
                    """INSERT INTO ivr_options (ivr_id, digit, dest_type, dest_value)
                       VALUES ($1,$2,$3,$4)""",
                    ivr_id, opt.digit, opt.dest_type, opt.dest_value)
    return {"id": ivr_id}


@router.patch("/{ivr_id}")
async def update_ivr(ivr_id: int, body: IvrIn,
                     tenant_id: int = Depends(tenant_scope)) -> dict:
    async with db.tx() as con:
        async with con.transaction():
            res = await con.execute(
                """UPDATE ivr_menus SET number=$3, name=$4, greeting=$5, timeout=$6,
                      max_retries=$7, direct_dial=$8, invalid_dest_type=$9,
                      invalid_dest_value=$10, timeout_dest_type=$11, timeout_dest_value=$12
                   WHERE id=$1 AND tenant_id=$2""",
                ivr_id, tenant_id, body.number, body.name, body.greeting, body.timeout,
                body.max_retries, body.direct_dial, body.invalid_dest_type,
                body.invalid_dest_value, body.timeout_dest_type, body.timeout_dest_value,
            )
            if res.endswith("0"):
                raise HTTPException(404, "IVR not found")
            await con.execute("DELETE FROM ivr_options WHERE ivr_id=$1", ivr_id)
            for opt in body.options:
                await con.execute(
                    """INSERT INTO ivr_options (ivr_id, digit, dest_type, dest_value)
                       VALUES ($1,$2,$3,$4)""",
                    ivr_id, opt.digit, opt.dest_type, opt.dest_value)
    return {"id": ivr_id}


@router.delete("/{ivr_id}", status_code=204)
async def delete_ivr(ivr_id: int, tenant_id: int = Depends(tenant_scope)):
    await db.execute(
        "DELETE FROM ivr_menus WHERE id=$1 AND tenant_id=$2", ivr_id, tenant_id)
