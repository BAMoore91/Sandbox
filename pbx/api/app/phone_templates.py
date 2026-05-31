"""Vendor-specific phone provisioning config renderers.

Given a device (MAC → extension), its SIP credentials, transport/host, and its
programmable keys, render the text config a desk phone fetches at boot. We
support Yealink (.cfg) and Grandstream (XML). Formats follow each vendor's
documented provisioning parameters:
  Yealink:     account.1.* + linekey.N.*   (type 16 = BLF, 13 = speed dial)
  Grandstream: P-value config (Pxxx) with VPK / multi-purpose keys (mode 23=BLF)
"""
from __future__ import annotations


# Yealink line-key types
_YL_TYPE = {"blf": "16", "speeddial": "13", "line": "15"}
# Grandstream VPK modes
_GS_MODE = {"blf": "23", "speeddial": "10", "line": "0"}


def render_yealink(*, ext: str, secret: str, display: str, sip_host: str,
                   sip_port: int, transport: str, keys: list[dict]) -> str:
    """Render a Yealink per-MAC <mac>.cfg."""
    proto = {"transport-udp": "0", "transport-tcp": "1", "transport-tls": "2"}.get(
        transport, "0")
    lines = [
        "#!version:1.0.0.1",
        "## OpenPBX auto-provisioned — Yealink",
        f'account.1.enable = 1',
        f'account.1.label = {display}',
        f'account.1.display_name = {display}',
        f'account.1.auth_name = {ext}',
        f'account.1.user_name = {ext}',
        f'account.1.password = {secret}',
        f'account.1.sip_server.1.address = {sip_host}',
        f'account.1.sip_server.1.port = {sip_port}',
        f'account.1.sip_server.1.transport_type = {proto}',
        # subscribe for BLF/MWI
        'account.1.subscribe_mwi = 1',
        'account.1.blf.subscribe_period = 1800',
    ]
    for k in keys:
        i = k["key_index"]
        t = _YL_TYPE.get(k["key_type"], "16")
        lines.append(f'linekey.{i}.type = {t}')
        lines.append(f'linekey.{i}.line = 1')
        lines.append(f'linekey.{i}.value = {k["value"]}')
        if k.get("label"):
            lines.append(f'linekey.{i}.label = {k["label"]}')
    return "\n".join(lines) + "\n"


def render_grandstream(*, ext: str, secret: str, display: str, sip_host: str,
                       sip_port: int, transport: str, keys: list[dict]) -> str:
    """Render a Grandstream cfg<mac>.xml (P-value gnkey config)."""
    proto = {"transport-udp": "0", "transport-tcp": "1", "transport-tls": "4"}.get(
        transport, "0")
    p: list[tuple[str, str]] = [
        ("P271", "1"),            # account 1 active
        ("P270", display),        # account name
        ("P47", sip_host),        # SIP server
        ("P35", ext),             # SIP user id
        ("P36", ext),             # auth id
        ("P34", secret),          # auth password
        ("P3", display),          # display name
        ("P2347", proto),         # transport
        ("P40", str(sip_port)),   # SIP port
    ]
    # Virtual/multi-purpose keys start at P323 in steps of 3 (mode/value/label)
    base = 323
    for n, k in enumerate(keys):
        mode = _GS_MODE.get(k["key_type"], "23")
        off = base + n * 3
        p.append((f"P{off}", mode))
        p.append((f"P{off+1}", k["value"]))
        if k.get("label"):
            p.append((f"P{off+2}", k["label"]))

    body = "\n".join(f"    <{k}>{_xml_escape(v)}</{k}>" for k, v in p)
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        "<gs_provision version=\"1\">\n"
        "  <config version=\"1\">\n"
        f"{body}\n"
        "  </config>\n"
        "</gs_provision>\n"
    )


def _xml_escape(s: str) -> str:
    return (s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
             .replace('"', "&quot;"))


def render(vendor: str, **kw) -> tuple[str, str]:
    """Return (content, content_type) for the vendor's config."""
    if vendor == "grandstream":
        return render_grandstream(**kw), "application/xml"
    return render_yealink(**kw), "text/plain"
