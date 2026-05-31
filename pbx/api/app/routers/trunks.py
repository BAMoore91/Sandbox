"""SIP trunks — Twilio Elastic SIP Trunking (or any SIP provider)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from .. import db
from ..asterisk import pjsip_reload
from ..deps import Principal, current_user, tenant_scope
from ..provisioning import deprovision_trunk, provision_trunk

router = APIRouter(prefix="/api/tenants/{tenant_id}/trunks", tags=["trunks"])

# Twilio Origination edge IPs (North America). Keep in sync with Twilio docs:
# https://www.twilio.com/docs/sip-trunking#origination
TWILIO_ORIGINATION_CIDRS = [
    "54.172.60.0/30", "34.203.250.0/23",
    "54.244.51.0/30", "54.171.127.192/30", "35.156.191.128/30",
]


class TrunkIn(BaseModel):
    name: str
    provider: str = "twilio"
    sip_server: str                       # Twilio termination URI host
    sip_port: int = 5060
    transport: str = "transport-udp"      # transport-udp | transport-tls
    auth_mode: str = "credentials"        # credentials | ipacl
    username: str | None = None
    secret: str | None = None
    from_domain: str | None = None
    codecs: str = "ulaw,alaw"
    media_encryption: str = "no"          # 'no' or 'sdes' for Twilio Secure Trunking
    register: bool = False
    acl_cidrs: list[str] | None = None    # defaults to Twilio ranges if omitted
    shared: bool = False                  # super-admin only: platform-wide trunk
    enabled: bool = True


async def _reprovision(trunk_id: int):
    t = await db.fetchrow("SELECT * FROM trunks WHERE id=$1", trunk_id)
    acls = [r["cidr"] for r in
            await db.fetch("SELECT cidr FROM trunk_acl WHERE trunk_id=$1", trunk_id)]
    async with db.tx() as con:
        async with con.transaction():
            await provision_trunk(
                con, trunk_id=trunk_id, tenant_id=t["tenant_id"],
                sip_server=t["sip_server"], sip_port=t["sip_port"],
                transport=t["transport"], auth_mode=t["auth_mode"],
                username=t["username"], secret=t["secret"],
                from_domain=t["from_domain"], codecs=t["codecs"],
                media_encryption=t["media_encryption"], register=t["register"],
                acl_cidrs=acls or TWILIO_ORIGINATION_CIDRS,
            )
    await pjsip_reload()


@router.get("")
async def list_trunks(tenant_id: int = Depends(tenant_scope)) -> list[dict]:
    rows = await db.fetch(
        "SELECT * FROM trunks WHERE tenant_id = $1 OR tenant_id IS NULL ORDER BY id",
        tenant_id)
    out = []
    for r in rows:
        d = dict(r)
        d.pop("secret", None)             # never leak secrets to the UI
        out.append(d)
    return out


@router.post("", status_code=201)
async def create_trunk(body: TrunkIn,
                       tenant_id: int = Depends(tenant_scope),
                       user: Principal = Depends(current_user)) -> dict:
    owner = None if (body.shared and user.is_superadmin) else tenant_id
    acls = body.acl_cidrs or TWILIO_ORIGINATION_CIDRS

    async with db.tx() as con:
        async with con.transaction():
            tid = await con.fetchval(
                """INSERT INTO trunks
                     (tenant_id, name, provider, endpoint_id, sip_server, sip_port,
                      transport, auth_mode, username, secret, from_domain, codecs,
                      media_encryption, register, enabled)
                   VALUES ($1,$2,$3,'pending',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
                   RETURNING id""",
                owner, body.name, body.provider, body.sip_server, body.sip_port,
                body.transport, body.auth_mode, body.username, body.secret,
                body.from_domain or body.sip_server, body.codecs,
                body.media_encryption, body.register, body.enabled,
            )
            endpoint_id = f"trunk-{tid}"
            await con.execute(
                "UPDATE trunks SET endpoint_id=$1 WHERE id=$2", endpoint_id, tid)
            for cidr in acls:
                await con.execute(
                    "INSERT INTO trunk_acl (trunk_id, cidr) VALUES ($1,$2)", tid, cidr)
            if body.enabled:
                await provision_trunk(
                    con, trunk_id=tid, tenant_id=owner,
                    sip_server=body.sip_server, sip_port=body.sip_port,
                    transport=body.transport, auth_mode=body.auth_mode,
                    username=body.username, secret=body.secret,
                    from_domain=body.from_domain or body.sip_server,
                    codecs=body.codecs, media_encryption=body.media_encryption,
                    register=body.register, acl_cidrs=acls,
                )
    await pjsip_reload()
    return {"id": tid, "endpoint_id": endpoint_id,
            "termination_uri": f"sip:{body.sip_server}:{body.sip_port}"}


@router.patch("/{trunk_id}")
async def update_trunk(trunk_id: int, body: TrunkIn,
                       tenant_id: int = Depends(tenant_scope)) -> dict:
    t = await db.fetchrow("SELECT * FROM trunks WHERE id=$1", trunk_id)
    if not t or (t["tenant_id"] not in (tenant_id, None)):
        raise HTTPException(404, "trunk not found")
    await db.execute(
        """UPDATE trunks SET name=$2, sip_server=$3, sip_port=$4, transport=$5,
              auth_mode=$6, username=$7, secret=COALESCE($8, secret), from_domain=$9,
              codecs=$10, media_encryption=$11, register=$12, enabled=$13
           WHERE id=$1""",
        trunk_id, body.name, body.sip_server, body.sip_port, body.transport,
        body.auth_mode, body.username, body.secret, body.from_domain or body.sip_server,
        body.codecs, body.media_encryption, body.register, body.enabled,
    )
    if body.acl_cidrs is not None:
        await db.execute("DELETE FROM trunk_acl WHERE trunk_id=$1", trunk_id)
        for cidr in body.acl_cidrs:
            await db.execute(
                "INSERT INTO trunk_acl (trunk_id, cidr) VALUES ($1,$2)", trunk_id, cidr)
    await _reprovision(trunk_id)
    return {"id": trunk_id, "status": "updated"}


@router.delete("/{trunk_id}", status_code=204)
async def delete_trunk(trunk_id: int, tenant_id: int = Depends(tenant_scope)):
    t = await db.fetchrow("SELECT endpoint_id, tenant_id FROM trunks WHERE id=$1", trunk_id)
    if not t or (t["tenant_id"] not in (tenant_id, None)):
        raise HTTPException(404, "trunk not found")
    async with db.tx() as con:
        async with con.transaction():
            await deprovision_trunk(con, t["endpoint_id"])
            await con.execute("DELETE FROM trunks WHERE id=$1", trunk_id)
    await pjsip_reload()
