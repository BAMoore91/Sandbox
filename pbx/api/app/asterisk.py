"""Asterisk control plane: ARI (REST, over httpx) for call origination and
endpoint state, plus a minimal AMI client for module reloads.

Realtime PJSIP means *new* objects are picked up on demand with no reload.
Edits/deletes to objects Asterisk already has cached are flushed with
`pjsip reload` via AMI.
"""
from __future__ import annotations

import asyncio

import httpx

from .config import settings


# ---------------------------------------------------------------------------
#  ARI
# ---------------------------------------------------------------------------
def _ari_auth() -> tuple[str, str]:
    return (settings.ari_username, settings.ari_password)


async def originate_click_to_call(
    *, slug: str, from_ext: str, to_number: str, caller_id: str | None = None
) -> dict:
    """Ring the agent's phone; when answered, the dialplan dials `to_number`."""
    endpoint = f"PJSIP/{slug}-{from_ext}"
    params = {
        "endpoint": endpoint,
        "extension": to_number,
        "context": "from-internal",
        "priority": 1,
        "callerId": caller_id or from_ext,
        "timeout": 30,
    }
    body = {"variables": {"TENANT": slug, "MYEXTEN": from_ext}}
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(
            f"{settings.asterisk_ari_url}/channels",
            params=params, json=body, auth=_ari_auth(),
        )
        r.raise_for_status()
        return r.json()


async def hangup_channel(channel_id: str) -> None:
    async with httpx.AsyncClient(timeout=15) as client:
        await client.delete(
            f"{settings.asterisk_ari_url}/channels/{channel_id}", auth=_ari_auth()
        )


async def list_endpoints() -> list[dict]:
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(
            f"{settings.asterisk_ari_url}/endpoints", auth=_ari_auth()
        )
        r.raise_for_status()
        return r.json()


async def ari_healthy() -> bool:
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            r = await client.get(
                f"{settings.asterisk_ari_url}/asterisk/info", auth=_ari_auth()
            )
            return r.status_code == 200
    except Exception:
        return False


# ---------------------------------------------------------------------------
#  AMI (minimal one-shot command)
# ---------------------------------------------------------------------------
async def ami_command(command: str) -> str:
    """Login to AMI, run a CLI `Command`, return the textual output."""
    try:
        reader, writer = await asyncio.open_connection(
            settings.asterisk_ami_host, settings.asterisk_ami_port
        )
    except OSError as exc:
        return f"AMI connect failed: {exc}"

    async def send(action: dict) -> None:
        msg = "".join(f"{k}: {v}\r\n" for k, v in action.items()) + "\r\n"
        writer.write(msg.encode())
        await writer.drain()

    await reader.readline()  # banner
    await send({"Action": "Login", "Username": settings.ami_username,
                "Secret": settings.ami_password})
    await send({"Action": "Command", "Command": command})
    await send({"Action": "Logoff"})

    chunks: list[str] = []
    try:
        while True:
            line = await asyncio.wait_for(reader.readline(), timeout=5)
            if not line:
                break
            chunks.append(line.decode(errors="ignore"))
    except asyncio.TimeoutError:
        pass
    finally:
        writer.close()
    return "".join(chunks)


async def pjsip_reload() -> None:
    await ami_command("pjsip reload")


async def ami_action(action: dict, terminator: str | None = None,
                     timeout: float = 5) -> list[dict]:
    """Run an AMI action and parse the reply into a list of event dicts.

    Reads until an event named `terminator` (e.g. 'QueueStatusComplete') or
    the socket goes quiet. Each blank-line-delimited block becomes one dict.
    """
    try:
        reader, writer = await asyncio.open_connection(
            settings.asterisk_ami_host, settings.asterisk_ami_port)
    except OSError:
        return []

    async def send(act: dict) -> None:
        msg = "".join(f"{k}: {v}\r\n" for k, v in act.items()) + "\r\n"
        writer.write(msg.encode())
        await writer.drain()

    await reader.readline()  # banner
    await send({"Action": "Login", "Username": settings.ami_username,
                "Secret": settings.ami_password})
    await send(action)

    events: list[dict] = []
    cur: dict = {}
    try:
        while True:
            line = await asyncio.wait_for(reader.readline(), timeout=timeout)
            if not line:
                break
            text = line.decode(errors="ignore").strip()
            if text == "":
                if cur:
                    events.append(cur)
                    if terminator and cur.get("Event") == terminator:
                        break
                    cur = {}
                continue
            if ": " in text:
                k, v = text.split(": ", 1)
                cur[k] = v
    except asyncio.TimeoutError:
        pass
    finally:
        try:
            await send({"Action": "Logoff"})
        except Exception:
            pass
        writer.close()
    if cur:
        events.append(cur)
    return events


async def live_channels() -> list[dict]:
    """Currently up channels (CoreShowChannels)."""
    evs = await ami_action({"Action": "CoreShowChannels"},
                           terminator="CoreShowChannelsComplete")
    return [e for e in evs if e.get("Event") == "CoreShowChannel"]


async def queue_status() -> list[dict]:
    """Raw QueueStatus events (QueueParams / QueueMember / QueueEntry)."""
    return await ami_action({"Action": "QueueStatus"},
                            terminator="QueueStatusComplete")
