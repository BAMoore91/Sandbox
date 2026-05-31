"""Custom audio prompts: customers upload greetings/announcements in the
portal; we transcode to 8 kHz mono PCM WAV onto the shared sounds volume that
Asterisk plays from. The dialplan references them as custom/<slug>/<name>.
"""
from __future__ import annotations

import asyncio
import os
import re

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse

from .. import db
from ..config import settings
from ..deps import tenant_slug

router = APIRouter(prefix="/api/tenants/{tenant_id}/prompts", tags=["prompts"])

_NAME_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$")
VALID_KINDS = {"greeting", "announcement", "moh"}


def _tenant_dir(slug: str) -> str:
    return os.path.join(settings.sounds_dir, slug)


async def _run(*cmd: str) -> tuple[int, str]:
    proc = await asyncio.create_subprocess_exec(
        *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT
    )
    out, _ = await proc.communicate()
    return proc.returncode or 0, out.decode(errors="ignore")


async def _probe_duration(path: str) -> float | None:
    code, out = await _run(
        "ffprobe", "-v", "error", "-show_entries", "format=duration",
        "-of", "default=nw=1:nk=1", path)
    try:
        return round(float(out.strip()), 2) if code == 0 else None
    except ValueError:
        return None


@router.get("")
async def list_prompts(ts: tuple[int, str] = Depends(tenant_slug)) -> list[dict]:
    tid, _ = ts
    rows = await db.fetch(
        """SELECT id, name, description, kind, sound_id, duration_sec, size_bytes,
                  original_name, created_at
           FROM prompts WHERE tenant_id=$1 ORDER BY kind, name""", tid)
    return [dict(r) for r in rows]


@router.post("", status_code=201)
async def upload_prompt(
    ts: tuple[int, str] = Depends(tenant_slug),
    name: str = Form(...),
    kind: str = Form("greeting"),
    description: str | None = Form(None),
    file: UploadFile = File(...),
) -> dict:
    tid, slug = ts
    name = name.strip().lower()
    if not _NAME_RE.match(name):
        raise HTTPException(422, "name must be 3-60 chars, lowercase letters/digits/hyphens")
    if kind not in VALID_KINDS:
        raise HTTPException(422, f"kind must be one of {sorted(VALID_KINDS)}")

    raw = await file.read()
    if len(raw) == 0:
        raise HTTPException(422, "empty file")
    if len(raw) > settings.max_prompt_bytes:
        raise HTTPException(413, "file too large")

    tenant_dir = _tenant_dir(slug)
    os.makedirs(tenant_dir, exist_ok=True)
    tmp_in = os.path.join(tenant_dir, f".upload-{name}")
    out_path = os.path.join(tenant_dir, f"{name}.wav")
    with open(tmp_in, "wb") as fh:
        fh.write(raw)

    # Transcode to the format Asterisk reads most reliably: 8kHz mono s16 WAV.
    code, log = await _run(
        "ffmpeg", "-y", "-i", tmp_in,
        "-ac", "1", "-ar", "8000", "-acodec", "pcm_s16le", out_path)
    try:
        os.remove(tmp_in)
    except OSError:
        pass
    if code != 0:
        raise HTTPException(422, f"could not transcode audio: {log[-300:]}")

    duration = await _probe_duration(out_path)
    size = os.path.getsize(out_path)
    sound_id = f"custom/{slug}/{name}"

    row = await db.fetchrow(
        """INSERT INTO prompts
             (tenant_id, name, description, kind, sound_id, filename,
              duration_sec, size_bytes, original_name)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT (tenant_id, name) DO UPDATE SET
             description=EXCLUDED.description, kind=EXCLUDED.kind,
             duration_sec=EXCLUDED.duration_sec, size_bytes=EXCLUDED.size_bytes,
             original_name=EXCLUDED.original_name
           RETURNING id, name, sound_id, duration_sec""",
        tid, name, description, kind, sound_id, out_path,
        duration, size, file.filename,
    )
    return dict(row)


@router.get("/{prompt_id}/audio")
async def get_audio(prompt_id: int, ts: tuple[int, str] = Depends(tenant_slug)):
    tid, _ = ts
    row = await db.fetchrow(
        "SELECT filename, name FROM prompts WHERE id=$1 AND tenant_id=$2",
        prompt_id, tid)
    if not row or not os.path.exists(row["filename"]):
        raise HTTPException(404, "prompt not found")
    return FileResponse(row["filename"], media_type="audio/wav",
                        filename=f"{row['name']}.wav")


@router.delete("/{prompt_id}", status_code=204)
async def delete_prompt(prompt_id: int, ts: tuple[int, str] = Depends(tenant_slug)):
    tid, _ = ts
    row = await db.fetchrow(
        "SELECT filename FROM prompts WHERE id=$1 AND tenant_id=$2", prompt_id, tid)
    if not row:
        raise HTTPException(404, "prompt not found")
    try:
        os.remove(row["filename"])
    except OSError:
        pass
    await db.execute("DELETE FROM prompts WHERE id=$1 AND tenant_id=$2", prompt_id, tid)
