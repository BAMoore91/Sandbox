"""Twilio account integration — auto-provision a SIP trunk and import numbers.

Given a tenant's Twilio API credentials (account SID + auth token, or an API
key/secret), this:
  * verifies the credentials,
  * one-click **auto-provisions** an Elastic SIP Trunk on Twilio (trunk +
    termination credential list + origination URL pointing back at this PBX)
    and wires it to a local trunk + PJSIP rows, and
  * **imports** the account's phone numbers as DIDs (optionally pointing each
    Twilio number's inbound at the new trunk).

Secrets are never returned to the UI. Admin (tenant-scoped) only.
"""
from __future__ import annotations

import secrets as _secrets

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from .. import db, twilio_client as tw
from ..asterisk import pjsip_reload
from ..config import settings
from ..deps import tenant_slug, tenant_scope
from ..provisioning import provision_trunk
from ..routers.trunks import TWILIO_ORIGINATION_CIDRS

router = APIRouter(prefix="/api/tenants/{tenant_id}/twilio", tags=["twilio"])


# ---------------------------------------------------------------------------
#  Credentials
# ---------------------------------------------------------------------------
class CredsIn(BaseModel):
    account_sid: str
    auth_token: str | None = None
    api_key_sid: str | None = None
    api_key_secret: str | None = None


async def _load_creds(tenant_id: int) -> tw.TwilioCreds:
    row = await db.fetchrow(
        """SELECT account_sid, auth_token, api_key_sid, api_key_secret
           FROM twilio_accounts WHERE tenant_id=$1""", tenant_id)
    if not row:
        raise HTTPException(404, "no Twilio account configured for this tenant")
    return tw.TwilioCreds(row["account_sid"], row["auth_token"],
                          row["api_key_sid"], row["api_key_secret"])


def _mask(row: dict) -> dict:
    """Strip secrets from a twilio_accounts row for UI display."""
    d = dict(row)
    for k in ("auth_token", "api_key_secret"):
        if d.get(k):
            d[k] = "••••" + str(d[k])[-4:]
    return d


@router.get("/account")
async def get_account(tenant_id: int = Depends(tenant_scope)) -> dict:
    row = await db.fetchrow(
        """SELECT account_sid, api_key_sid, auth_token, api_key_secret,
                  trunk_sid, credential_list_sid, domain_prefix, trunk_id,
                  last_synced_at
           FROM twilio_accounts WHERE tenant_id=$1""", tenant_id)
    return _mask(row) if row else {"configured": False}


@router.put("/account")
async def set_account(body: CredsIn, tenant_id: int = Depends(tenant_scope)) -> dict:
    if not body.account_sid.startswith("AC"):
        raise HTTPException(422, "account_sid must start with 'AC'")
    if not (body.auth_token or (body.api_key_sid and body.api_key_secret)):
        raise HTTPException(422, "provide an auth_token or an api_key_sid + api_key_secret")
    # Verify before saving so we never store bad creds.
    creds = tw.TwilioCreds(body.account_sid, body.auth_token,
                           body.api_key_sid, body.api_key_secret)
    try:
        info = await tw.verify(creds)
    except tw.TwilioError as exc:
        raise HTTPException(400, f"credential check failed: {exc}")

    await db.execute(
        """INSERT INTO twilio_accounts
             (tenant_id, account_sid, auth_token, api_key_sid, api_key_secret, updated_at)
           VALUES ($1,$2,$3,$4,$5, now())
           ON CONFLICT (tenant_id) DO UPDATE SET
             account_sid=EXCLUDED.account_sid, auth_token=EXCLUDED.auth_token,
             api_key_sid=EXCLUDED.api_key_sid, api_key_secret=EXCLUDED.api_key_secret,
             updated_at=now()""",
        tenant_id, body.account_sid, body.auth_token,
        body.api_key_sid, body.api_key_secret)
    return {"verified": True, "account": info}


@router.post("/verify")
async def verify_account(tenant_id: int = Depends(tenant_scope)) -> dict:
    creds = await _load_creds(tenant_id)
    try:
        return {"ok": True, "account": await tw.verify(creds)}
    except tw.TwilioError as exc:
        raise HTTPException(400, str(exc))


# ---------------------------------------------------------------------------
#  Auto-provision the SIP trunk on Twilio + wire it locally
# ---------------------------------------------------------------------------
class ProvisionIn(BaseModel):
    name: str = "Twilio Trunk"
    secure: bool = False              # TLS + SRTP termination/origination
    domain_prefix: str | None = None  # <prefix>.pstn.twilio.com (default: slug+rand)


@router.post("/provision-trunk")
async def provision_twilio_trunk(body: ProvisionIn,
                                 ts: tuple[int, str] = Depends(tenant_slug)) -> dict:
    tid, slug = ts
    creds = await _load_creds(tid)

    transport = "transport-tls" if body.secure else "transport-udp"
    media_enc = "sdes" if body.secure else "no"
    port = settings.sip_tls_port if body.secure else settings.sip_udp_port
    scheme_port = settings.sip_tls_port if body.secure else settings.sip_udp_port
    # Origination URI points Twilio's inbound at this PBX.
    sip_url = (f"sip:{settings.public_hostname}:{scheme_port}"
               + (";transport=tls" if body.secure else ""))
    prefix = (body.domain_prefix
              or f"{slug}-{_secrets.token_hex(3)}").lower().replace("_", "-")
    term_user = f"{slug}-trunk"
    term_pass = _secrets.token_urlsafe(18)

    # 1) create the local trunk row first so we have a stable trunk-<id>.
    sip_server = f"{prefix}.pstn.twilio.com"
    trunk_id = await db.fetchval(
        """INSERT INTO trunks
             (tenant_id, name, provider, endpoint_id, sip_server, sip_port,
              transport, auth_mode, username, secret, from_domain, codecs,
              media_encryption, register, enabled)
           VALUES ($1,$2,'twilio','pending',$3,$4,$5,'credentials',$6,$7,$3,
                   'ulaw,alaw',$8,false,true) RETURNING id""",
        tid, body.name, sip_server, port, transport, term_user, term_pass, media_enc)
    endpoint_id = f"trunk-{trunk_id}"
    await db.execute("UPDATE trunks SET endpoint_id=$1 WHERE id=$2", endpoint_id, trunk_id)

    # 2) create everything on Twilio (best-effort; record what we made).
    try:
        trunk = await tw.create_trunk(creds, body.name, prefix, secure=body.secure)
        trunk_sid = trunk["sid"]
        await tw.add_origination_url(creds, trunk_sid, sip_url=sip_url)
        cl = await tw.create_credential_list(creds, f"{slug} termination",
                                             term_user, term_pass)
        await tw.attach_credential_list(creds, trunk_sid, cl["sid"])
    except tw.TwilioError as exc:
        # roll back the half-created local trunk so the user can retry cleanly
        await db.execute("DELETE FROM trunks WHERE id=$1", trunk_id)
        raise HTTPException(502, f"Twilio provisioning failed: {exc}")

    # 3) wire the local PJSIP rows (endpoint/aor/auth/identify) for the trunk.
    async with db.tx() as con:
        async with con.transaction():
            await provision_trunk(
                con, trunk_id=trunk_id, tenant_id=tid, sip_server=sip_server,
                sip_port=port, transport=transport, auth_mode="credentials",
                username=term_user, secret=term_pass, from_domain=sip_server,
                codecs="ulaw,alaw", media_encryption=media_enc, register=False,
                acl_cidrs=TWILIO_ORIGINATION_CIDRS)
    await pjsip_reload()

    # 4) remember the Twilio object ids for idempotency + number association.
    await db.execute(
        """UPDATE twilio_accounts SET trunk_sid=$2, credential_list_sid=$3,
             domain_prefix=$4, trunk_id=$5, updated_at=now()
           WHERE tenant_id=$1""",
        tid, trunk_sid, cl["sid"], prefix, trunk_id)

    return {"trunk_id": trunk_id, "twilio_trunk_sid": trunk_sid,
            "termination_uri": f"sip:{sip_server}", "origination_url": sip_url,
            "termination_user": term_user}


# ---------------------------------------------------------------------------
#  Import phone numbers as DIDs
# ---------------------------------------------------------------------------
@router.get("/numbers")
async def list_twilio_numbers(tenant_id: int = Depends(tenant_scope)) -> list[dict]:
    """Live list of the account's Twilio numbers, flagged if already imported."""
    creds = await _load_creds(tenant_id)
    try:
        nums = await tw.list_numbers(creds)
    except tw.TwilioError as exc:
        raise HTTPException(400, str(exc))
    existing = {r["number"] for r in await db.fetch(
        "SELECT number FROM dids WHERE tenant_id=$1", tenant_id)}
    for n in nums:
        n["imported"] = n["phone_number"] in existing
    return nums


class ImportIn(BaseModel):
    numbers: list[str] | None = None   # specific E.164 numbers; None = all
    dest_type: str = "ivr"             # default inbound destination for new DIDs
    dest_value: str = "500"
    attach_to_trunk: bool = True       # route the Twilio number at our trunk


@router.post("/import-numbers")
async def import_numbers(body: ImportIn,
                         ts: tuple[int, str] = Depends(tenant_slug)) -> dict:
    tid, slug = ts
    creds = await _load_creds(tid)
    acct = await db.fetchrow(
        "SELECT trunk_sid, trunk_id FROM twilio_accounts WHERE tenant_id=$1", tid)
    try:
        nums = await tw.list_numbers(creds)
    except tw.TwilioError as exc:
        raise HTTPException(400, str(exc))

    want = set(body.numbers) if body.numbers else None
    imported = skipped = attached = 0
    for n in nums:
        e164 = n["phone_number"]
        if want is not None and e164 not in want:
            continue
        # idempotent: skip a number already assigned to any tenant
        owned = await db.fetchval("SELECT tenant_id FROM dids WHERE number=$1", e164)
        if owned is not None:
            skipped += 1
            continue
        await db.execute(
            """INSERT INTO dids
                 (tenant_id, number, trunk_id, description, dest_type, dest_value,
                  enabled, twilio_sid, source)
               VALUES ($1,$2,$3,$4,$5,$6,true,$7,'twilio')""",
            tid, e164, acct["trunk_id"] if acct else None,
            n.get("friendly_name") or "Imported from Twilio",
            body.dest_type, body.dest_value, n.get("sid"))
        imported += 1
        # point the Twilio number's inbound at our trunk so calls reach us
        if body.attach_to_trunk and acct and acct["trunk_sid"] and n.get("sid"):
            try:
                await tw.attach_number_to_trunk(creds, acct["trunk_sid"], n["sid"])
                attached += 1
            except tw.TwilioError:
                pass
    await db.execute(
        "UPDATE twilio_accounts SET last_synced_at=now() WHERE tenant_id=$1", tid)
    return {"imported": imported, "skipped_existing": skipped,
            "attached_to_trunk": attached}
