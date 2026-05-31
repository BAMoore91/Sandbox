"""Data-retention sweeps: auto-purge recordings and CDR older than each
tenant's configured window.

A recording purge deletes the file from the shared monitor volume *and* the
catalog row. A CDR purge deletes old call rows. ``0`` days means keep forever.

``run_retention_once`` performs one full pass over all tenants and records a
``retention_runs`` row per tenant that actually had a window configured. The
scheduler (started from the app lifespan) calls it once a day; admins can also
trigger it on demand via the API.
"""
from __future__ import annotations

import asyncio
import os

from . import db
from .config import settings
from .routers.recordings import resolve_recording_path


async def _purge_tenant(tenant_id: int, slug: str,
                        rec_days: int, cdr_days: int) -> dict:
    """Purge one tenant; returns counts. Records a retention_runs row."""
    run_id = await db.fetchval(
        "INSERT INTO retention_runs (tenant_id) VALUES ($1) RETURNING id", tenant_id)
    recordings_deleted = files_deleted = files_missing = cdr_deleted = 0
    error = None
    try:
        # --- recordings -----------------------------------------------------
        if rec_days and rec_days > 0:
            rows = await db.fetch(
                """SELECT id, path FROM recordings
                   WHERE tenant_id = $1
                     AND created_at < now() - ($2 || ' days')::interval""",
                tenant_id, str(rec_days))
            for r in rows:
                # Delete the file first; tolerate bad/missing paths.
                try:
                    path = resolve_recording_path(slug, r["path"])
                    if os.path.exists(path):
                        os.remove(path)
                        files_deleted += 1
                        _prune_empty_dirs(os.path.dirname(path), slug)
                    else:
                        files_missing += 1
                except Exception:
                    files_missing += 1
                await db.execute("DELETE FROM recordings WHERE id = $1", r["id"])
                recordings_deleted += 1

        # --- CDR ------------------------------------------------------------
        if cdr_days and cdr_days > 0:
            res = await db.execute(
                """DELETE FROM cdr
                   WHERE tenant_id = $1
                     AND calldate < now() - ($2 || ' days')::interval""",
                tenant_id, str(cdr_days))
            # asyncpg returns e.g. "DELETE 42"
            try:
                cdr_deleted = int(res.split()[-1])
            except (ValueError, IndexError):
                cdr_deleted = 0
    except Exception as exc:  # pragma: no cover - defensive
        error = str(exc)[:500]

    await db.execute(
        """UPDATE retention_runs
           SET finished_at = now(), recordings_deleted = $2, cdr_deleted = $3,
               files_deleted = $4, files_missing = $5, error = $6
           WHERE id = $1""",
        run_id, recordings_deleted, cdr_deleted, files_deleted, files_missing, error)

    return {
        "tenant_id": tenant_id, "slug": slug,
        "recordings_deleted": recordings_deleted, "files_deleted": files_deleted,
        "files_missing": files_missing, "cdr_deleted": cdr_deleted, "error": error,
    }


def _prune_empty_dirs(start: str, slug: str) -> None:
    """Remove now-empty date dirs up to (but not including) the tenant root."""
    try:
        base = os.path.realpath(settings.recordings_dir)
        tenant_root = os.path.realpath(os.path.join(base, slug))
        cur = os.path.realpath(start)
        while cur.startswith(tenant_root + os.sep) and cur != tenant_root:
            if os.path.isdir(cur) and not os.listdir(cur):
                os.rmdir(cur)
                cur = os.path.dirname(cur)
            else:
                break
    except OSError:
        pass


async def run_retention_once(tenant_id: int | None = None) -> list[dict]:
    """Run retention for one tenant (if given) or all configured tenants."""
    where = "WHERE id = $1" if tenant_id is not None else ""
    args = [tenant_id] if tenant_id is not None else []
    tenants = await db.fetch(
        f"""SELECT id, slug, recording_retention_days, cdr_retention_days
            FROM tenants {where}""", *args)
    results = []
    for t in tenants:
        rec, cdr = t["recording_retention_days"], t["cdr_retention_days"]
        # Skip tenants with nothing to purge (unless explicitly targeted).
        if tenant_id is None and not (rec > 0 or cdr > 0):
            continue
        results.append(await _purge_tenant(t["id"], t["slug"], rec, cdr))
    return results


async def retention_scheduler(stop: asyncio.Event) -> None:
    """Background loop: run a sweep shortly after boot, then every interval."""
    interval = settings.retention_interval_hours * 3600
    # small initial delay so the API finishes coming up first
    try:
        await asyncio.wait_for(stop.wait(), timeout=60)
        return
    except asyncio.TimeoutError:
        pass
    while not stop.is_set():
        try:
            await run_retention_once()
        except Exception:
            pass  # never let the loop die on a bad sweep
        try:
            await asyncio.wait_for(stop.wait(), timeout=interval)
        except asyncio.TimeoutError:
            continue
