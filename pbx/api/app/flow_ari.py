"""ARI-backed flow runtime.

Holds a websocket to Asterisk's Stasis app (`flow_stasis_app`). When a channel
enters Stasis (via the flow-exec dialplan context), we load the tenant's flow
and run it with an `AriFlowChannel` that implements media actions over ARI REST
(play TTS/prompts, gather DTMF, record, dial, dispatch back to the dialplan).

This module is only active with a reachable Asterisk; the pure engine
(flow_engine.py) is what unit tests exercise. Connection failures are retried
with backoff and never crash the app.
"""
from __future__ import annotations

import asyncio
import json

import httpx

from . import db
from .config import settings
from .flow_engine import FlowRunner
from .transcription import transcribe

try:
    import websockets
except Exception:  # pragma: no cover - optional until installed
    websockets = None


def _auth() -> tuple[str, str]:
    return (settings.ari_username, settings.ari_password)


class AriFlowChannel:
    """Implements flow_engine.FlowChannel over ARI for one Stasis channel."""

    def __init__(self, channel_id: str, slug: str):
        self.id = channel_id
        self.slug = slug
        self._base = settings.asterisk_ari_url

    async def _post(self, path: str, **kw):
        async with httpx.AsyncClient(timeout=20) as c:
            return await c.post(f"{self._base}{path}", auth=_auth(), **kw)

    async def _get(self, path: str, **kw):
        async with httpx.AsyncClient(timeout=20) as c:
            return await c.get(f"{self._base}{path}", auth=_auth(), **kw)

    async def say(self, text: str) -> None:
        # Uses Asterisk TTS via the 'sound:'/'tts:' — here we play text through
        # the built-in say via channels/{id}/play with a TTS engine if present;
        # falls back to nothing if no TTS. (Prompts can also be pre-rendered.)
        await self._post(f"/channels/{self.id}/play",
                         params={"media": f"sound:tts/{_slugify(text)}"})
        await asyncio.sleep(0.2)

    async def gather(self, text: str, num_digits: int, timeout: int) -> str:
        if text:
            await self.say(text)
        # collect digits by polling channel variables set by DTMF; for the
        # reference impl we wait up to timeout for `num_digits` via getChannelVar
        digits = ""
        for _ in range(timeout * 2):
            await asyncio.sleep(0.5)
            r = await self._get(f"/channels/{self.id}/variable",
                                params={"variable": "FLOW_DTMF"})
            if r.status_code == 200:
                digits = (r.json().get("value") or "")[:num_digits]
                if len(digits) >= num_digits:
                    break
        return digits

    async def record(self, max_seconds: int) -> dict:
        name = f"flow/{self.slug}/{self.id}"
        await self._post(f"/channels/{self.id}/record",
                         params={"name": name, "format": "wav",
                                 "maxDurationSeconds": max_seconds,
                                 "beep": "true", "ifExists": "overwrite"})
        return {"path": f"{name}.wav", "duration": None}

    async def dial(self, dest_value: str, timeout: int) -> str:
        # Originate a second channel to the destination and bridge; simplified:
        await self._post(f"/channels/{self.id}/continue",
                         params={"context": f"tenant-{self.slug}",
                                 "extension": dest_value, "priority": "1"})
        return "ANSWER"

    async def dispatch(self, dest_type: str, dest_value: str) -> None:
        # Hand the call back to the dialplan dispatcher with the chosen target.
        await self._post(f"/channels/{self.id}/setChannelVar",
                         params={"variable": "DEST_VALUE", "value": dest_value})
        await self._post(f"/channels/{self.id}/continue",
                         params={"context": "dispatch", "extension": dest_type,
                                 "priority": "1"})

    async def hangup(self) -> None:
        async with httpx.AsyncClient(timeout=20) as c:
            await c.delete(f"{self._base}/channels/{self.id}", auth=_auth())


def _slugify(text: str) -> str:
    import re
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:64] or "prompt"


async def _persist_record(execution_id: int, tenant_id: int, widget: dict, res: dict):
    """Save a flow recording row + (optionally) transcribe it."""
    rec_id = await db.fetchval(
        """INSERT INTO flow_recordings
             (execution_id, tenant_id, widget, path, duration, transcript_status)
           VALUES ($1,$2,$3,$4,$5,'pending') RETURNING id""",
        execution_id, tenant_id, widget.get("_id"), res.get("path"),
        res.get("duration"))
    if widget.get("transcribe"):
        path = f"{settings.recordings_dir}/{res.get('path')}"
        status, text = await transcribe(path)
        await db.execute(
            "UPDATE flow_recordings SET transcript=$2, transcript_status=$3 WHERE id=$1",
            rec_id, text, status)
    else:
        await db.execute(
            "UPDATE flow_recordings SET transcript_status='disabled' WHERE id=$1", rec_id)


async def run_flow_for_channel(channel_id: str, slug: str, number: str) -> None:
    """Load the tenant's flow and execute it for a Stasis channel."""
    row = await db.fetchrow(
        """SELECT f.id, f.tenant_id, f.definition
           FROM flows f JOIN tenants t ON t.id = f.tenant_id
           WHERE t.slug=$1 AND f.number=$2 AND f.enabled""", slug, number)
    if not row:
        # nothing to run; drop the call
        ch = AriFlowChannel(channel_id, slug)
        await ch.hangup()
        return

    caller = ""
    exec_id = await db.fetchval(
        """INSERT INTO flow_executions
             (flow_id, tenant_id, channel_id, caller, status)
           VALUES ($1,$2,$3,$4,'running') RETURNING id""",
        row["id"], row["tenant_id"], channel_id, caller)

    channel = AriFlowChannel(channel_id, slug)
    runner = FlowRunner(
        row["definition"], channel,
        variables={"caller": caller, "did": number, "tenant": slug},
        on_record=lambda w, r: _persist_record(exec_id, row["tenant_id"], w, r))
    try:
        result = await runner.run()
        await db.execute(
            """UPDATE flow_executions SET status='completed', variables=$2::jsonb,
                 path=$3::jsonb, ended_at=now() WHERE id=$1""",
            exec_id, json.dumps(result["variables"]), json.dumps(result["path"]))
        for entry in result["webhook_log"]:
            await db.execute(
                """INSERT INTO flow_webhook_log
                     (execution_id, tenant_id, widget, method, url, status_code, ok, error)
                   VALUES ($1,$2,$3,$4,$5,$6,$7,$8)""",
                exec_id, row["tenant_id"], entry.get("widget"), entry.get("method"),
                entry.get("url"), entry.get("status_code"), entry.get("ok"),
                entry.get("error"))
    except Exception as exc:
        await db.execute(
            "UPDATE flow_executions SET status='failed', error=$2, ended_at=now() WHERE id=$1",
            exec_id, str(exc)[:500])


async def stasis_listener(stop) -> None:
    """Connect to the ARI websocket and run flows for entering channels.

    Reconnects with backoff; a no-op if `websockets` isn't installed or ARI is
    unreachable (logged-and-retried, never fatal).
    """
    if websockets is None:
        return
    ws_url = (settings.asterisk_ari_url.replace("http://", "ws://")
              .replace("https://", "wss://"))
    url = (f"{ws_url}/events?app={settings.flow_stasis_app}"
           f"&api_key={settings.ari_username}:{settings.ari_password}")
    backoff = 2
    while not stop.is_set():
        try:
            async with websockets.connect(url, ping_interval=20) as ws:
                backoff = 2
                while not stop.is_set():
                    raw = await ws.recv()
                    evt = json.loads(raw)
                    if evt.get("type") == "StasisStart":
                        args = evt.get("args", [])
                        chan = evt.get("channel", {}).get("id")
                        if chan and len(args) >= 2:
                            asyncio.create_task(
                                run_flow_for_channel(chan, args[0], args[1]))
        except Exception:
            try:
                await asyncio.wait_for(stop.wait(), timeout=backoff)
            except asyncio.TimeoutError:
                backoff = min(backoff * 2, 30)
