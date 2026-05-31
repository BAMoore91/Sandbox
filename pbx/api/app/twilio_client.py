"""Twilio REST client (httpx, no SDK) for auto-provisioning SIP trunks and
importing phone numbers.

Two API hosts are used:
  * https://trunking.twilio.com/v1   — Elastic SIP Trunking (trunks, origination
    URLs, credential lists, phone-number association)
  * https://api.twilio.com/2010-04-01 — account resources (IncomingPhoneNumbers)

Auth: an API Key (SKxxx + secret) is preferred when present; otherwise the
account SID + auth token. All calls are scoped to the credentials passed in, so
one platform serves many tenants each with their own Twilio account.
"""
from __future__ import annotations

from dataclasses import dataclass

import httpx

TRUNKING = "https://trunking.twilio.com/v1"
API = "https://api.twilio.com/2010-04-01"


class TwilioError(Exception):
    pass


@dataclass
class TwilioCreds:
    account_sid: str
    auth_token: str | None = None
    api_key_sid: str | None = None
    api_key_secret: str | None = None

    def http_auth(self) -> tuple[str, str]:
        # API key/secret preferred; both authenticate against the same account.
        if self.api_key_sid and self.api_key_secret:
            return (self.api_key_sid, self.api_key_secret)
        if self.auth_token:
            return (self.account_sid, self.auth_token)
        raise TwilioError("no Twilio credentials (need auth token or API key)")


async def _req(method: str, url: str, creds: TwilioCreds, **kw) -> dict:
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.request(method, url, auth=creds.http_auth(), **kw)
    if r.status_code >= 400:
        try:
            msg = r.json().get("message", r.text[:300])
        except Exception:
            msg = r.text[:300]
        raise TwilioError(f"Twilio {r.status_code}: {msg}")
    if r.status_code == 204 or not r.content:
        return {}
    return r.json()


# ---------------------------------------------------------------------------
#  Verify / account
# ---------------------------------------------------------------------------
async def verify(creds: TwilioCreds) -> dict:
    """Confirm credentials work; return basic account info."""
    data = await _req("GET", f"{API}/Accounts/{creds.account_sid}.json", creds)
    return {"sid": data.get("sid"), "friendly_name": data.get("friendly_name"),
            "status": data.get("status")}


# ---------------------------------------------------------------------------
#  Phone numbers
# ---------------------------------------------------------------------------
async def list_numbers(creds: TwilioCreds) -> list[dict]:
    """All IncomingPhoneNumbers on the account (paged)."""
    out: list[dict] = []
    url = f"{API}/Accounts/{creds.account_sid}/IncomingPhoneNumbers.json?PageSize=100"
    while url:
        data = await _req("GET", url, creds)
        for n in data.get("incoming_phone_numbers", []):
            out.append({
                "sid": n.get("sid"),
                "phone_number": n.get("phone_number"),
                "friendly_name": n.get("friendly_name"),
                "trunk_sid": n.get("trunk_sid"),
                "voice_url": n.get("voice_url"),
            })
        nxt = data.get("next_page_uri")
        url = f"https://api.twilio.com{nxt}" if nxt else None
    return out


async def attach_number_to_trunk(creds: TwilioCreds, trunk_sid: str,
                                 number_sid: str) -> dict:
    """Route an IncomingPhoneNumber's inbound calls into the trunk."""
    return await _req(
        "POST", f"{TRUNKING}/Trunks/{trunk_sid}/PhoneNumbers", creds,
        data={"PhoneNumberSid": number_sid})


# ---------------------------------------------------------------------------
#  Trunk auto-provisioning
# ---------------------------------------------------------------------------
async def create_trunk(creds: TwilioCreds, friendly_name: str,
                       domain_prefix: str, secure: bool = False) -> dict:
    """Create an Elastic SIP Trunk with a termination domain."""
    return await _req(
        "POST", f"{TRUNKING}/Trunks", creds,
        data={"FriendlyName": friendly_name,
              "DomainName": f"{domain_prefix}.pstn.twilio.com",
              "Secure": "true" if secure else "false"})


async def add_origination_url(creds: TwilioCreds, trunk_sid: str, *,
                              sip_url: str, friendly_name: str = "OpenPBX",
                              priority: int = 10, weight: int = 10) -> dict:
    """Point the trunk's inbound (origination) at this PBX's public SIP URI."""
    return await _req(
        "POST", f"{TRUNKING}/Trunks/{trunk_sid}/OriginationUrls", creds,
        data={"FriendlyName": friendly_name, "SipUrl": sip_url,
              "Priority": str(priority), "Weight": str(weight), "Enabled": "true"})


async def create_credential_list(creds: TwilioCreds, friendly_name: str,
                                 username: str, password: str) -> dict:
    """Create a credential list + one credential for trunk termination auth."""
    cl = await _req("POST", f"{API}/Accounts/{creds.account_sid}"
                    f"/SIP/CredentialLists.json", creds,
                    data={"FriendlyName": friendly_name})
    cl_sid = cl.get("sid")
    await _req("POST", f"{API}/Accounts/{creds.account_sid}"
               f"/SIP/CredentialLists/{cl_sid}/Credentials.json", creds,
               data={"Username": username, "Password": password})
    return {"sid": cl_sid}


async def attach_credential_list(creds: TwilioCreds, trunk_sid: str,
                                 credential_list_sid: str) -> dict:
    """Associate a credential list with the trunk (termination auth)."""
    return await _req(
        "POST", f"{TRUNKING}/Trunks/{trunk_sid}/CredentialLists", creds,
        data={"CredentialListSid": credential_list_sid})
