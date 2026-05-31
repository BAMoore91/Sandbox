"""Voice transcription for flow 'record' widgets.

Pluggable: with `transcription_provider="openai"` and an API key, a recorded
WAV is sent to the Whisper API. With no provider configured it returns a
'disabled' status so recordings still save cleanly.
"""
from __future__ import annotations

import os

import httpx

from .config import settings


async def transcribe(wav_path: str) -> tuple[str, str]:
    """Return (status, text). status ∈ done|failed|disabled."""
    provider = settings.transcription_provider
    if not provider:
        return ("disabled", "")
    if provider == "openai":
        return await _openai(wav_path)
    return ("failed", f"unknown provider '{provider}'")


async def _openai(wav_path: str) -> tuple[str, str]:
    if not settings.openai_api_key:
        return ("failed", "OPENAI_API_KEY not set")
    if not os.path.exists(wav_path):
        return ("failed", "recording file missing")
    try:
        with open(wav_path, "rb") as fh:
            files = {"file": (os.path.basename(wav_path), fh, "audio/wav")}
            data = {"model": settings.openai_transcribe_model}
            async with httpx.AsyncClient(timeout=120) as client:
                r = await client.post(
                    "https://api.openai.com/v1/audio/transcriptions",
                    headers={"Authorization": f"Bearer {settings.openai_api_key}"},
                    data=data, files=files)
        if r.status_code >= 400:
            return ("failed", f"openai {r.status_code}: {r.text[:200]}")
        return ("done", r.json().get("text", ""))
    except Exception as exc:
        return ("failed", str(exc)[:300])
