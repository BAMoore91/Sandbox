"""Auto phone provisioning + BLF key management.

Two surfaces:
  * Admin (tenant-scoped, authed): register devices by MAC, assign an
    extension, and define each phone's programmable BLF/speed-dial/line keys.
  * Provisioning fetch (unauthenticated, token-guarded): a desk phone boots and
    GETs /api/provision/<mac>.cfg (Yealink) or /api/provision/cfg<mac>.xml
    (Grandstream); we return its rendered config with the SIP account + keys.

The fetch endpoint is unauthenticated because phones can't log in, so it's
guarded by an optional per-device token in the URL and should be served over
TLS on the LAN/VPN the phones live on. It records last_seen for visibility.
"""
from __future__ import annotations

import re

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import PlainTextResponse, Response
from pydantic import BaseModel

from .. import db
from ..config import settings
from ..deps import tenant_scope
from ..phone_templates import render

VALID_VENDORS = {"yealink", "grandstream"}
VALID_KEY_TYPES = {"blf", "speeddial", "line"}
_MAC_RE = re.compile(r"^[0-9a-f]{12}$")


def _norm_mac(raw: str) -> str:
    m = re.sub(r"[^0-9a-fA-F]", "", raw).lower()
    if not _MAC_RE.match(m):
        raise HTTPException(422, "MAC must be 12 hex digits")
    return m


# ===========================================================================
#  Admin: devices
# ===========================================================================
router = APIRouter(prefix="/api/tenants/{tenant_id}/devices", tags=["provisioning"])


class DeviceIn(BaseModel):
    mac: str
    vendor: str = "yealink"
    model: str | None = None
    extension: str | None = None
    label: str | None = None
    provision_token: str | None = None


@router.get("")
async def list_devices(tenant_id: int = Depends(tenant_scope)) -> list[dict]:
    rows = await db.fetch(
        """SELECT id, mac, vendor, model, extension, label, provision_token,
                  last_seen_at, last_ip, created_at
           FROM devices WHERE tenant_id=$1 ORDER BY extension, mac""", tenant_id)
    return [dict(r) for r in rows]


@router.post("", status_code=201)
async def create_device(body: DeviceIn, tenant_id: int = Depends(tenant_scope)) -> dict:
    if body.vendor not in VALID_VENDORS:
        raise HTTPException(422, f"vendor must be one of {sorted(VALID_VENDORS)}")
    mac = _norm_mac(body.mac)
    if body.extension:
        owns = await db.fetchval(
            "SELECT 1 FROM extensions WHERE tenant_id=$1 AND extension=$2",
            tenant_id, body.extension)
        if not owns:
            raise HTTPException(422, "extension not found in this company")
    try:
        did = await db.fetchval(
            """INSERT INTO devices
                 (tenant_id, mac, vendor, model, extension, label, provision_token)
               VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id""",
            tenant_id, mac, body.vendor, body.model, body.extension,
            body.label, body.provision_token)
    except Exception:
        raise HTTPException(409, "MAC already registered or extension already assigned")
    url = _provision_url(mac, body.vendor, body.provision_token)
    return {"id": did, "mac": mac, "provisioning_url": url}


@router.patch("/{device_id}")
async def update_device(device_id: int, body: DeviceIn,
                        tenant_id: int = Depends(tenant_scope)) -> dict:
    if body.extension:
        owns = await db.fetchval(
            "SELECT 1 FROM extensions WHERE tenant_id=$1 AND extension=$2",
            tenant_id, body.extension)
        if not owns:
            raise HTTPException(422, "extension not found in this company")
    res = await db.execute(
        """UPDATE devices SET vendor=$3, model=$4, extension=$5, label=$6,
             provision_token=$7 WHERE id=$1 AND tenant_id=$2""",
        device_id, tenant_id, body.vendor, body.model, body.extension,
        body.label, body.provision_token)
    if res.endswith("0"):
        raise HTTPException(404, "device not found")
    return {"id": device_id, "status": "updated"}


@router.delete("/{device_id}", status_code=204)
async def delete_device(device_id: int, tenant_id: int = Depends(tenant_scope)):
    await db.execute("DELETE FROM devices WHERE id=$1 AND tenant_id=$2",
                     device_id, tenant_id)


# ===========================================================================
#  Admin: BLF / programmable keys (per owning extension)
# ===========================================================================
keys_router = APIRouter(prefix="/api/tenants/{tenant_id}/extensions/{extension}/keys",
                        tags=["provisioning"])


class BlfKeyIn(BaseModel):
    key_index: int
    key_type: str = "blf"
    label: str | None = None
    value: str


@keys_router.get("")
async def list_keys(extension: str, tenant_id: int = Depends(tenant_scope)) -> list[dict]:
    rows = await db.fetch(
        """SELECT id, key_index, key_type, label, value FROM blf_keys
           WHERE tenant_id=$1 AND extension=$2 ORDER BY key_index""",
        tenant_id, extension)
    return [dict(r) for r in rows]


@keys_router.put("")
async def set_keys(extension: str, keys: list[BlfKeyIn],
                   tenant_id: int = Depends(tenant_scope)) -> dict:
    """Replace the full set of programmable keys for an extension."""
    owns = await db.fetchval(
        "SELECT 1 FROM extensions WHERE tenant_id=$1 AND extension=$2",
        tenant_id, extension)
    if not owns:
        raise HTTPException(404, "extension not found")
    for k in keys:
        if k.key_type not in VALID_KEY_TYPES:
            raise HTTPException(422, f"key_type must be one of {sorted(VALID_KEY_TYPES)}")
    async with db.tx() as con:
        async with con.transaction():
            await con.execute(
                "DELETE FROM blf_keys WHERE tenant_id=$1 AND extension=$2",
                tenant_id, extension)
            for k in keys:
                await con.execute(
                    """INSERT INTO blf_keys
                         (tenant_id, extension, key_index, key_type, label, value)
                       VALUES ($1,$2,$3,$4,$5,$6)""",
                    tenant_id, extension, k.key_index, k.key_type, k.label, k.value)
    return {"extension": extension, "keys": len(keys)}


# ===========================================================================
#  Unauthenticated provisioning fetch (phones boot and GET this)
# ===========================================================================
fetch_router = APIRouter(prefix="/api/provision", tags=["provisioning"])


def _provision_url(mac: str, vendor: str, token: str | None) -> str:
    base = settings.provision_base_url or settings.public_base_url or ""
    fname = f"cfg{mac}.xml" if vendor == "grandstream" else f"{mac}.cfg"
    q = f"?token={token}" if token else ""
    return f"{base}/api/provision/{fname}{q}"


async def _serve(mac: str, vendor_hint: str, token: str | None,
                 request: Request) -> Response:
    mac = _norm_mac(mac)
    dev = await db.fetchrow(
        """SELECT d.*, t.slug, t.timezone
           FROM devices d JOIN tenants t ON t.id = d.tenant_id
           WHERE d.mac = $1""", mac)
    if not dev or not dev["extension"]:
        raise HTTPException(404, "unknown device or no extension assigned")
    # Optional per-device token gate.
    if dev["provision_token"] and token != dev["provision_token"]:
        raise HTTPException(403, "invalid provisioning token")

    ext = dev["extension"]
    endpoint_id = f"{dev['slug']}-{ext}"
    acct = await db.fetchrow(
        """SELECT a.password, e.display_name
           FROM ps_auths a JOIN extensions e
             ON e.endpoint_id = a.id
           WHERE a.id = $1""", endpoint_id)
    if not acct:
        raise HTTPException(404, "extension account not found")

    keys = await db.fetch(
        """SELECT key_index, key_type, label, value FROM blf_keys
           WHERE tenant_id=$1 AND extension=$2 ORDER BY key_index""",
        dev["tenant_id"], ext)

    content, ctype = render(
        dev["vendor"],
        ext=ext, secret=acct["password"], display=acct["display_name"] or ext,
        sip_host=settings.public_hostname, sip_port=settings.sip_udp_port,
        transport="transport-udp",
        keys=[dict(k) for k in keys])

    # Record provisioning fetch for visibility.
    ip = request.client.host if request.client else None
    await db.execute(
        "UPDATE devices SET last_seen_at=now(), last_ip=$2 WHERE id=$1",
        dev["id"], ip)

    return PlainTextResponse(content, media_type=ctype)


@fetch_router.get("/{mac}.cfg")
async def yealink_cfg(mac: str, request: Request,
                      token: str | None = Query(None)) -> Response:
    return await _serve(mac, "yealink", token, request)


@fetch_router.get("/cfg{mac}.xml")
async def grandstream_cfg(mac: str, request: Request,
                          token: str | None = Query(None)) -> Response:
    return await _serve(mac, "grandstream", token, request)
