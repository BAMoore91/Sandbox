"""Text-to-speech for AI-generated prompts.

Turns typed text into spoken audio (mp3 bytes) that the prompts router then
transcodes to Asterisk-ready 8 kHz WAV. Pluggable like transcription.py: with
`tts_provider="openai"` and an API key it calls the OpenAI speech API; with no
provider configured it raises so the caller can surface a clear error.

OpenAI voices (as of the gpt-4o-mini-tts / tts-1 models): alloy, echo, fable,
onyx, nova, shimmer. We don't hardcode the list beyond a default; the API
rejects an unknown voice.
"""
from __future__ import annotations

import httpx

from .config import settings


def enabled() -> bool:
    return bool(settings.tts_provider)


class TTSError(Exception):
    pass


async def synthesize(text: str, voice: str | None = None) -> bytes:
    """Return spoken-audio bytes (mp3) for `text`. Raises TTSError on failure."""
    if not text or not text.strip():
        raise TTSError("empty text")
    provider = settings.tts_provider
    if not provider:
        raise TTSError("TTS is not configured on this server")
    if provider == "openai":
        return await _openai(text, voice or settings.openai_tts_voice)
    raise TTSError(f"unknown TTS provider '{provider}'")


async def _openai(text: str, voice: str) -> bytes:
    if not settings.openai_api_key:
        raise TTSError("OPENAI_API_KEY not set")
    payload = {
        "model": settings.openai_tts_model,
        "input": text,
        "voice": voice,
        "response_format": "mp3",
    }
    try:
        async with httpx.AsyncClient(timeout=120) as client:
            r = await client.post(
                "https://api.openai.com/v1/audio/speech",
                headers={"Authorization": f"Bearer {settings.openai_api_key}"},
                json=payload)
    except Exception as exc:
        raise TTSError(f"TTS request failed: {exc}") from exc
    if r.status_code >= 400:
        raise TTSError(f"openai {r.status_code}: {r.text[:200]}")
    return r.content
