"""Fax engine — inbound fax-to-email and outbound send-fax.

Asterisk handles the T.38/spandsp media (ReceiveFAX/SendFAX in the dialplan).
This module:
  * converts between PDF and the TIFF format spandsp uses (ghostscript / tiff2pdf),
  * on inbound completion, converts the received TIFF to PDF and emails it to
    the fax box's recipients,
  * on outbound send, converts the uploaded PDF to TIFF and originates a call
    via ARI into [fax-send],
  * listens on the ARI Stasis app 'openpbx-fax' for completion events from both
    directions and updates the `faxes` job rows.

Media conversion runs in a thread (subprocess); everything is DB-logged so the
portal shows job status. Driver-agnostic enough that conversion + DB logic are
exercisable without a live Asterisk.
"""
from __future__ import annotations

import asyncio
import json
import os
import smtplib
from email.message import EmailMessage

import httpx

from . import db
from .config import settings

try:
    import websockets
except Exception:  # pragma: no cover
    websockets = None


# ---------------------------------------------------------------------------
#  Media conversion (PDF <-> TIFF) via subprocess
# ---------------------------------------------------------------------------
async def _run(*cmd: str) -> tuple[int, str]:
    proc = await asyncio.create_subprocess_exec(
        *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT)
    out, _ = await proc.communicate()
    return proc.returncode or 0, out.decode(errors="ignore")


async def pdf_to_tiff(pdf_path: str, tiff_path: str) -> None:
    """Render a PDF to a Group 4 fax TIFF (204x196 dpi, 1728px wide)."""
    code, log = await _run(
        "gs", "-q", "-dNOPAUSE", "-dBATCH", "-dSAFER",
        "-sDEVICE=tiffg4", "-r204x196", "-g1728x2156",
        f"-sOutputFile={tiff_path}", pdf_path)
    if code != 0 or not os.path.exists(tiff_path):
        raise RuntimeError(f"pdf->tiff failed: {log[-300:]}")


async def tiff_to_pdf(tiff_path: str, pdf_path: str) -> None:
    """Wrap a received fax TIFF into a PDF (tiff2pdf from libtiff-tools)."""
    code, log = await _run("tiff2pdf", "-o", pdf_path, tiff_path)
    if code != 0 or not os.path.exists(pdf_path):
        raise RuntimeError(f"tiff->pdf failed: {log[-300:]}")


# ---------------------------------------------------------------------------
#  Email delivery (inbound fax-to-email) with PDF attachment
# ---------------------------------------------------------------------------
def _send_email_with_pdf(to_list: list[str], subject: str, body: str,
                         pdf_path: str) -> None:
    msg = EmailMessage()
    msg["From"] = settings.smtp_from
    msg["To"] = ", ".join(to_list)
    msg["Subject"] = subject
    msg.set_content(body)
    with open(pdf_path, "rb") as fh:
        msg.add_attachment(fh.read(), maintype="application", subtype="pdf",
                           filename=os.path.basename(pdf_path))
    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=30) as s:
        if settings.smtp_use_tls:
            s.starttls()
        if settings.smtp_user:
            s.login(settings.smtp_user, settings.smtp_password)
        s.send_message(msg)


async def email_fax(to_list: list[str], subject: str, body: str, pdf_path: str) -> None:
    if not settings.smtp_host:
        raise RuntimeError("SMTP not configured")
    await asyncio.to_thread(_send_email_with_pdf, to_list, subject, body, pdf_path)


def _abs(path: str) -> str:
    """Map an Asterisk spool path (/var/spool/asterisk/fax/...) to the API's
    mounted fax dir, or pass through an already-absolute fax-dir path."""
    marker = "/var/spool/asterisk/fax/"
    if path.startswith(marker):
        return os.path.join(settings.fax_dir, path[len(marker):])
    return path


# ---------------------------------------------------------------------------
#  Inbound completion: TIFF -> PDF -> email the fax box
# ---------------------------------------------------------------------------
async def handle_inbound(tenant_slug: str, faxbox: str, tiff_path: str,
                         status: str, pages: str, src: str, did: str) -> int:
    tenant = await db.fetchrow("SELECT id FROM tenants WHERE slug=$1", tenant_slug)
    tid = tenant["id"] if tenant else None
    ok = status.upper() in ("SUCCESS", "")
    tiff_abs = _abs(tiff_path)
    pdf_abs = tiff_abs.rsplit(".", 1)[0] + ".pdf"
    fax_id = await db.fetchval(
        """INSERT INTO faxes
             (tenant_id, direction, faxbox, src, dst, status, pages, tiff_path)
           VALUES ($1,'inbound',$2,$3,$4,$5,$6,$7) RETURNING id""",
        tid, faxbox, src, did, "received" if ok else "failed",
        int(pages) if str(pages).isdigit() else None, tiff_path)
    if not ok:
        await db.execute("UPDATE faxes SET error=$2, completed_at=now() WHERE id=$1",
                         fax_id, f"FAXSTATUS={status}")
        return fax_id
    # convert + email
    try:
        await tiff_to_pdf(tiff_abs, pdf_abs)
        await db.execute("UPDATE faxes SET pdf_path=$2, completed_at=now() WHERE id=$1",
                         fax_id, pdf_abs)
    except Exception as exc:
        await db.execute("UPDATE faxes SET error=$2 WHERE id=$1", fax_id, str(exc)[:300])
        return fax_id

    box = await db.fetchrow(
        "SELECT email, name FROM fax_boxes WHERE tenant_id=$1 AND number=$2",
        tid, faxbox)
    if box and box["email"] and settings.smtp_host:
        recips = [e.strip() for e in box["email"].split(",") if e.strip()]
        try:
            await email_fax(
                recips, f"New fax from {src or 'unknown'} ({pages} pages)",
                f"You received a {pages}-page fax to {did} on box "
                f"{box['name'] or faxbox}. The PDF is attached.", pdf_abs)
        except Exception as exc:
            await db.execute("UPDATE faxes SET error=$2 WHERE id=$1",
                             fax_id, f"email failed: {str(exc)[:200]}")
    return fax_id


# ---------------------------------------------------------------------------
#  Outbound: PDF -> TIFF -> originate the call via ARI into [fax-send]
# ---------------------------------------------------------------------------
def _ari_auth() -> tuple[str, str]:
    return (settings.ari_username, settings.ari_password)


async def send_fax(tenant_id: int, slug: str, to_number: str, pdf_path: str,
                   caller_id: str, header: str, trunk_endpoint: str) -> int:
    """Create a fax job, convert PDF->TIFF, originate the send call."""
    tiff_path = pdf_path.rsplit(".", 1)[0] + ".tiff"
    fax_id = await db.fetchval(
        """INSERT INTO faxes (tenant_id, direction, src, dst, status, pdf_path)
           VALUES ($1,'outbound',$2,$3,'pending',$4) RETURNING id""",
        tenant_id, caller_id, to_number, pdf_path)
    try:
        await pdf_to_tiff(pdf_path, tiff_path)
    except Exception as exc:
        await db.execute("UPDATE faxes SET status='failed', error=$2, completed_at=now() "
                         "WHERE id=$1", fax_id, str(exc)[:300])
        raise

    # spandsp on the Asterisk side reads the spool path, not the API mount.
    spool_tiff = "/var/spool/asterisk/fax/" + os.path.relpath(tiff_path, settings.fax_dir)
    await db.execute("UPDATE faxes SET status='sending', tiff_path=$2 WHERE id=$1",
                     fax_id, spool_tiff)

    params = {
        "endpoint": f"PJSIP/{to_number}@{trunk_endpoint}",
        "extension": to_number, "context": "fax-send", "priority": 1,
        "callerId": caller_id, "timeout": 60,
    }
    body = {"variables": {
        "FAXFILE": spool_tiff, "FAXHEADER": header or "", "FAXJOB": str(fax_id),
        "FAXCID": caller_id, "TENANT": slug,
    }}
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            r = await client.post(f"{settings.asterisk_ari_url}/channels",
                                  params=params, json=body, auth=_ari_auth())
            r.raise_for_status()
            await db.execute("UPDATE faxes SET channel_id=$2 WHERE id=$1",
                             fax_id, r.json().get("id"))
    except Exception as exc:
        await db.execute("UPDATE faxes SET status='failed', error=$2, completed_at=now() "
                         "WHERE id=$1", fax_id, f"originate failed: {str(exc)[:200]}")
        raise
    return fax_id


async def _complete_outbound(job_id: str, status: str, pages: str) -> None:
    ok = status.upper() == "SUCCESS"
    await db.execute(
        """UPDATE faxes SET status=$2, pages=$3, error=$4, completed_at=now()
           WHERE id=$1""",
        int(job_id), "sent" if ok else "failed",
        int(pages) if str(pages).isdigit() else None,
        None if ok else f"FAXSTATUS={status}")


# ---------------------------------------------------------------------------
#  Stasis listener — completion events from [fax-receive] and [fax-send]
# ---------------------------------------------------------------------------
async def fax_stasis_listener(stop) -> None:
    if websockets is None:
        return
    ws_url = (settings.asterisk_ari_url.replace("http://", "ws://")
              .replace("https://", "wss://"))
    url = (f"{ws_url}/events?app={settings.fax_stasis_app}"
           f"&api_key={settings.ari_username}:{settings.ari_password}")
    backoff = 2
    while not stop.is_set():
        try:
            async with websockets.connect(url, ping_interval=20) as ws:
                backoff = 2
                while not stop.is_set():
                    evt = json.loads(await ws.recv())
                    if evt.get("type") != "StasisStart":
                        continue
                    args = evt.get("args", [])
                    chan = evt.get("channel", {}).get("id")
                    try:
                        if args and args[0] == "inbound" and len(args) >= 9:
                            await handle_inbound(args[1], args[2], args[3], args[4],
                                                 args[5], args[6], args[7])
                        elif args and args[0] == "outbound" and len(args) >= 4:
                            await _complete_outbound(args[1], args[2], args[3])
                    finally:
                        # release the Stasis channel
                        try:
                            async with httpx.AsyncClient(timeout=10) as c:
                                await c.delete(
                                    f"{settings.asterisk_ari_url}/channels/{chan}",
                                    auth=_ari_auth())
                        except Exception:
                            pass
        except Exception:
            try:
                await asyncio.wait_for(stop.wait(), timeout=backoff)
            except asyncio.TimeoutError:
                backoff = min(backoff * 2, 30)
