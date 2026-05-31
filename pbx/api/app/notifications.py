"""Notification delivery worker.

Missed-call and voicemail events are enqueued into the ``notifications`` table
(by the dialplan via func_odbc, and by the voicemail externnotify hook through
the internal enqueue endpoint). This worker drains pending rows and delivers
them by email (SMTP) and/or SMS (Twilio REST), with capped exponential-backoff
retries. A Postgres advisory lock ensures only one API replica delivers at a
time (others still enqueue fine).
"""
from __future__ import annotations

import asyncio
import smtplib
from email.message import EmailMessage

import httpx

from . import db
from .config import settings

NOTIFY_LOCK_KEY = 0x0FB1_0007  # advisory-lock key for the notification worker


# ---------------------------------------------------------------------------
#  Channel senders
# ---------------------------------------------------------------------------
def _send_email_sync(to: str, subject: str, body: str) -> None:
    """Blocking SMTP send (run in a thread)."""
    msg = EmailMessage()
    msg["From"] = settings.smtp_from
    msg["To"] = to
    msg["Subject"] = subject or "OpenPBX notification"
    msg.set_content(body)

    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=20) as s:
        if settings.smtp_use_tls:
            s.starttls()
        if settings.smtp_user:
            s.login(settings.smtp_user, settings.smtp_password)
        s.send_message(msg)


async def _send_email(to: str, subject: str, body: str) -> None:
    if not settings.smtp_host:
        raise RuntimeError("SMTP not configured (SMTP_HOST empty)")
    await asyncio.to_thread(_send_email_sync, to, subject, body)


async def _send_sms(to: str, body: str) -> None:
    if not (settings.twilio_account_sid and settings.twilio_auth_token
            and settings.twilio_sms_from):
        raise RuntimeError("Twilio SMS not configured")
    url = (f"https://api.twilio.com/2010-04-01/Accounts/"
           f"{settings.twilio_account_sid}/Messages.json")
    data = {"To": to, "Body": body}
    # twilio_sms_from may be an E.164 number or a Messaging Service SID (MG...).
    if settings.twilio_sms_from.startswith("MG"):
        data["MessagingServiceSid"] = settings.twilio_sms_from
    else:
        data["From"] = settings.twilio_sms_from
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.post(
            url, data=data,
            auth=(settings.twilio_account_sid, settings.twilio_auth_token))
        if r.status_code >= 300:
            raise RuntimeError(f"Twilio {r.status_code}: {r.text[:200]}")


async def _deliver_one(row) -> None:
    """Deliver a single notification row; update status with retry/backoff."""
    try:
        if row["channel"] == "email":
            await _send_email(row["recipient"], row["subject"] or "", row["body"])
        elif row["channel"] == "sms":
            await _send_sms(row["recipient"], row["body"])
        else:
            raise RuntimeError(f"unknown channel {row['channel']}")
        await db.execute(
            "UPDATE notifications SET status='sent', sent_at=now(), attempts=attempts+1 "
            "WHERE id=$1", row["id"])
    except Exception as exc:
        attempts = row["attempts"] + 1
        failed = attempts >= settings.notify_max_attempts
        # exponential backoff: 1,2,4,8… minutes
        backoff_min = 2 ** min(attempts, 6)
        await db.execute(
            """UPDATE notifications
               SET attempts=$2, last_error=$3,
                   status = CASE WHEN $4 THEN 'failed' ELSE 'pending' END,
                   next_attempt_at = now() + ($5 || ' minutes')::interval
               WHERE id=$1""",
            row["id"], attempts, str(exc)[:500], failed, str(backoff_min))


async def deliver_pending(limit: int = 50) -> int:
    """Deliver up to `limit` due notifications. Returns count attempted."""
    rows = await db.fetch(
        """SELECT id, channel, recipient, subject, body, attempts
           FROM notifications
           WHERE status='pending' AND next_attempt_at <= now()
           ORDER BY created_at LIMIT $1""",
        limit)
    for row in rows:
        await _deliver_one(row)
    return len(rows)


async def notification_worker(stop: asyncio.Event) -> None:
    """Background loop: drain the outbox every notify_poll_seconds.

    Advisory-locked so only one replica delivers; if it can't get the lock it
    just waits for the next tick.
    """
    interval = settings.notify_poll_seconds
    while not stop.is_set():
        try:
            async with db.advisory_lock(NOTIFY_LOCK_KEY) as acquired:
                if acquired:
                    # keep draining while there's a full batch to send
                    while (await deliver_pending()) >= 50 and not stop.is_set():
                        pass
        except Exception:
            pass  # never let the loop die
        try:
            await asyncio.wait_for(stop.wait(), timeout=interval)
        except asyncio.TimeoutError:
            continue


# ---------------------------------------------------------------------------
#  Enqueue (used by the internal endpoint / externnotify hook)
# ---------------------------------------------------------------------------
async def enqueue_event(slug: str, extension: str, event: str,
                        caller: str | None, did: str | None) -> int:
    """Fan out an event to the extension's enabled channels. Returns row count.

    Mirrors the dialplan's ODBC_NOTIFY SQL so email/SMS bodies are consistent
    whichever path enqueued them.
    """
    subject_vm = f"New voicemail for {extension}"
    subject_missed = f"Missed call for {extension}"
    caller_disp = caller or "unknown"
    body_vm = f"New voicemail on extension {extension} from {caller_disp}"
    body_missed = f"Missed call on extension {extension} from {caller_disp}"
    if settings.public_base_url and event == "voicemail":
        body_vm += f"\n\nListen in your portal: {settings.public_base_url}/me"

    res = await db.execute(
        """INSERT INTO notifications
             (tenant_id, extension, event, channel, recipient, subject, body, caller, did)
           SELECT e.tenant_id, e.extension, $3::varchar, ch.channel, ch.recipient,
                  CASE WHEN $3::varchar='voicemail' THEN $5::varchar ELSE $6::varchar END,
                  CASE WHEN $3::varchar='voicemail' THEN $7::text ELSE $8::text END,
                  NULLIF($4::varchar,''), NULLIF($9::varchar,'')
           FROM extensions e JOIN tenants t ON t.id = e.tenant_id
           CROSS JOIN LATERAL (VALUES
              ('email', COALESCE(NULLIF(e.notify_email,''), e.email), e.notify_channel_email),
              ('sms',   e.notify_sms, e.notify_channel_sms)
           ) AS ch(channel, recipient, enabled)
           WHERE t.slug=$1 AND e.extension=$2
             AND ch.enabled AND ch.recipient IS NOT NULL AND ch.recipient <> ''
             AND ( ($3::varchar='missed' AND e.notify_on_missed)
                OR ($3::varchar='voicemail' AND e.notify_on_voicemail) )""",
        slug, extension, event, caller or "",
        subject_vm, subject_missed, body_vm, body_missed, did or "")
    try:
        return int(res.split()[-1])
    except (ValueError, IndexError):
        return 0
