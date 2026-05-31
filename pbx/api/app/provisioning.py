"""Translate high-level objects (extensions, trunks) into the PJSIP realtime
rows that Asterisk reads. All functions take an asyncpg connection so callers
can wrap them in a transaction alongside the management-table writes.

Because Asterisk reads these tables live (sorcery realtime), changes take
effect with no reload for new objects; edits to an *existing in-memory*
endpoint may need `pjsip reload`/`pjsip qualify`, which the API triggers via
ARI when needed.
"""
from __future__ import annotations

import asyncpg


# ---------------------------------------------------------------------------
#  Extensions (phones)
# ---------------------------------------------------------------------------
async def provision_extension(
    con: asyncpg.Connection,
    *,
    tenant_id: int,
    slug: str,
    extension: str,
    display_name: str,
    sip_password: str,
    webrtc: bool = True,
    ring_seconds: int = 25,
) -> str:
    endpoint_id = f"{slug}-{extension}"
    transport = "transport-wss" if webrtc else "transport-udp"
    mailbox = f"{extension}@{slug}"
    callerid = f"{display_name} <{extension}>"

    await con.execute(
        """INSERT INTO ps_aors (id, max_contacts, remove_existing, qualify_frequency, tenant_id)
           VALUES ($1, 3, 'yes', 60, $2)
           ON CONFLICT (id) DO UPDATE SET tenant_id = EXCLUDED.tenant_id""",
        endpoint_id, tenant_id,
    )
    await con.execute(
        """INSERT INTO ps_auths (id, auth_type, username, password, tenant_id)
           VALUES ($1, 'userpass', $1, $2, $3)
           ON CONFLICT (id) DO UPDATE SET password = EXCLUDED.password""",
        endpoint_id, sip_password, tenant_id,
    )
    await con.execute(
        """INSERT INTO ps_endpoints
             (id, transport, aors, auth, context, disallow, allow, callerid, mailboxes,
              webrtc, use_avpf, media_encryption, dtls_auto_generate_cert, rtcp_mux,
              ice_support, rtp_symmetric, force_rport, rewrite_contact, set_var,
              accountcode, tenant_id)
           VALUES
             ($1, $2, $1, $1, 'from-internal', 'all', $3, $4, $5,
              $6, $6, $7, $6, $6, $6, 'yes', 'yes', 'yes', $8, $9, $10)
           ON CONFLICT (id) DO UPDATE SET
              transport = EXCLUDED.transport, allow = EXCLUDED.allow,
              callerid = EXCLUDED.callerid, webrtc = EXCLUDED.webrtc,
              use_avpf = EXCLUDED.use_avpf, media_encryption = EXCLUDED.media_encryption,
              set_var = EXCLUDED.set_var""",
        endpoint_id, transport,
        "opus,ulaw,alaw" if webrtc else "ulaw,alaw,opus",
        callerid, mailbox,
        "yes" if webrtc else "no",
        "dtls" if webrtc else "no",
        f"TENANT={slug},MYEXTEN={extension}",
        slug, tenant_id,
    )
    return endpoint_id


async def deprovision_extension(con: asyncpg.Connection, endpoint_id: str) -> None:
    await con.execute("DELETE FROM ps_contacts WHERE endpoint = $1", endpoint_id)
    await con.execute("DELETE FROM ps_endpoints WHERE id = $1", endpoint_id)
    await con.execute("DELETE FROM ps_auths WHERE id = $1", endpoint_id)
    await con.execute("DELETE FROM ps_aors WHERE id = $1", endpoint_id)


# ---------------------------------------------------------------------------
#  SIP trunks (Twilio Elastic SIP Trunk and friends)
# ---------------------------------------------------------------------------
async def provision_trunk(
    con: asyncpg.Connection,
    *,
    trunk_id: int,
    tenant_id: int | None,
    sip_server: str,
    sip_port: int,
    transport: str,
    auth_mode: str,
    username: str | None,
    secret: str | None,
    from_domain: str | None,
    codecs: str,
    media_encryption: str,
    register: bool,
    acl_cidrs: list[str],
) -> str:
    endpoint_id = f"trunk-{trunk_id}"
    contact = f"sip:{sip_server}:{sip_port}"

    await con.execute(
        """INSERT INTO ps_aors (id, contact, qualify_frequency, max_contacts, tenant_id)
           VALUES ($1, $2, 60, 1, $3)
           ON CONFLICT (id) DO UPDATE SET contact = EXCLUDED.contact""",
        endpoint_id, contact, tenant_id,
    )

    if auth_mode == "credentials" and username:
        await con.execute(
            """INSERT INTO ps_auths (id, auth_type, username, password, realm, tenant_id)
               VALUES ($1, 'userpass', $2, $3, $4, $5)
               ON CONFLICT (id) DO UPDATE SET
                  username = EXCLUDED.username, password = EXCLUDED.password,
                  realm = EXCLUDED.realm""",
            endpoint_id, username, secret, from_domain, tenant_id,
        )
        outbound_auth = endpoint_id
    else:
        await con.execute("DELETE FROM ps_auths WHERE id = $1", endpoint_id)
        outbound_auth = None

    await con.execute(
        """INSERT INTO ps_endpoints
             (id, transport, aors, outbound_auth, context, disallow, allow, from_domain,
              rtp_symmetric, force_rport, rewrite_contact, direct_media, media_encryption,
              set_var, tenant_id)
           VALUES ($1, $2, $1, $3, 'from-twilio', 'all', $4, $5,
                   'yes', 'yes', 'yes', 'no', $6, $7, $8)
           ON CONFLICT (id) DO UPDATE SET
              transport = EXCLUDED.transport, outbound_auth = EXCLUDED.outbound_auth,
              allow = EXCLUDED.allow, from_domain = EXCLUDED.from_domain,
              media_encryption = EXCLUDED.media_encryption, set_var = EXCLUDED.set_var""",
        endpoint_id, transport, outbound_auth, codecs, from_domain,
        media_encryption, f"TRUNK={trunk_id}", tenant_id,
    )

    # IP identify rows (so inbound from the provider is matched to this trunk)
    await con.execute("DELETE FROM ps_endpoint_id_ips WHERE endpoint = $1", endpoint_id)
    for i, cidr in enumerate(acl_cidrs, start=1):
        await con.execute(
            """INSERT INTO ps_endpoint_id_ips (id, endpoint, "match", tenant_id)
               VALUES ($1, $2, $3, $4)""",
            f"{endpoint_id}-ip{i}", endpoint_id, cidr, tenant_id,
        )

    # Optional outbound registration (only if the provider requires REGISTER)
    await con.execute("DELETE FROM ps_registrations WHERE id = $1", endpoint_id)
    if register and username:
        await con.execute(
            """INSERT INTO ps_registrations
                 (id, transport, server_uri, client_uri, outbound_auth, retry_interval,
                  max_retries, expiration, endpoint, tenant_id)
               VALUES ($1, $2, $3, $4, $5, 60, 0, 3600, $1, $6)""",
            endpoint_id, transport,
            f"sip:{sip_server}:{sip_port}",
            f"sip:{username}@{from_domain or sip_server}",
            outbound_auth, tenant_id,
        )
    return endpoint_id


async def deprovision_trunk(con: asyncpg.Connection, endpoint_id: str) -> None:
    await con.execute("DELETE FROM ps_registrations WHERE id = $1", endpoint_id)
    await con.execute("DELETE FROM ps_endpoint_id_ips WHERE endpoint = $1", endpoint_id)
    await con.execute("DELETE FROM ps_endpoints WHERE id = $1", endpoint_id)
    await con.execute("DELETE FROM ps_auths WHERE id = $1", endpoint_id)
    await con.execute("DELETE FROM ps_aors WHERE id = $1", endpoint_id)
