"""Call-recording catalog + playback.

Recordings are produced by Asterisk's MixMonitor into a shared volume; the
relative path (``<slug>/<YYYY>/<MM>/<DD>/<uniqueid>.wav``) is stored in
``recordings.path`` and ``cdr.recording``. The API serves the audio back,
resolving the path against ``settings.recordings_dir`` and refusing anything
that escapes the tenant's own subtree.

Admins see all of their company's recordings; the agent equivalent lives in
``/api/me`` (own calls only).
"""
from __future__ import annotations

import os

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse

from .. import db
from ..config import settings
from ..deps import tenant_scope, tenant_slug

router = APIRouter(prefix="/api/tenants/{tenant_id}/recordings", tags=["recordings"])


def resolve_recording_path(slug: str, rel_path: str) -> str:
    """Safely map a stored relative path to an absolute file under the tenant.

    Guards against path traversal: the resolved path must stay within
    ``<recordings_dir>/<slug>``. Returns the absolute path (existence not
    guaranteed) or raises 400/403.
    """
    if not rel_path:
        raise HTTPException(404, "no recording for this entry")
    base = os.path.realpath(settings.recordings_dir)
    tenant_root = os.path.realpath(os.path.join(base, slug))
    target = os.path.realpath(os.path.join(base, rel_path))
    # The path must belong to this tenant's subtree.
    if target != tenant_root and not target.startswith(tenant_root + os.sep):
        raise HTTPException(403, "recording path outside tenant scope")
    return target


@router.get("")
async def list_recordings(
    tenant_id: int = Depends(tenant_scope),
    src: str | None = Query(None),
    dst: str | None = Query(None),
    limit: int = Query(100, le=1000),
    offset: int = Query(0, ge=0),
) -> dict:
    where = ["tenant_id = $1"]
    args: list = [tenant_id]
    for col, val in (("src", src), ("dst", dst)):
        if val:
            args.append(val)
            where.append(f"{col} = ${len(args)}")
    clause = " AND ".join(where)
    total = await db.fetchval(f"SELECT count(*) FROM recordings WHERE {clause}", *args)
    args += [limit, offset]
    rows = await db.fetch(
        f"""SELECT id, uniqueid, path, src, dst, duration, created_at
            FROM recordings WHERE {clause}
            ORDER BY created_at DESC LIMIT ${len(args)-1} OFFSET ${len(args)}""",
        *args,
    )
    return {"total": total, "items": [dict(r) for r in rows]}


@router.get("/{recording_id}/audio")
async def stream_recording(recording_id: int,
                           ts: tuple[int, str] = Depends(tenant_slug)):
    tid, slug = ts
    row = await db.fetchrow(
        "SELECT path FROM recordings WHERE id=$1 AND tenant_id=$2", recording_id, tid)
    if not row:
        raise HTTPException(404, "recording not found")
    path = resolve_recording_path(slug, row["path"])
    if not os.path.exists(path):
        raise HTTPException(404, "recording file not found (may still be in progress)")
    return FileResponse(path, media_type="audio/wav",
                        filename=os.path.basename(path))


@router.delete("/{recording_id}", status_code=204)
async def delete_recording(recording_id: int,
                           ts: tuple[int, str] = Depends(tenant_slug)):
    tid, slug = ts
    row = await db.fetchrow(
        "SELECT path FROM recordings WHERE id=$1 AND tenant_id=$2", recording_id, tid)
    if not row:
        raise HTTPException(404, "recording not found")
    try:
        path = resolve_recording_path(slug, row["path"])
        if os.path.exists(path):
            os.remove(path)
    except HTTPException:
        pass  # bad/escaping path: drop the DB row anyway
    await db.execute(
        "DELETE FROM recordings WHERE id=$1 AND tenant_id=$2", recording_id, tid)
