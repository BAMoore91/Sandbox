"""FastAPI application: wiring, lifespan, super-admin bootstrap."""
from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import db
from .asterisk import ari_healthy
from .config import settings
from .notifications import notification_worker
from .retention import retention_scheduler
from .security import hash_password
from .routers import (
    auth, calls, cdr, dids, extensions, ivr, me, notifications, prompts,
    queues, recordings, retention, ringgroups, routes, status, tenants,
    timeconditions, trunks, voicemail,
)


async def _bootstrap_admin() -> None:
    """Create the first platform super-admin if no users exist yet."""
    if not (settings.bootstrap_admin_email and settings.bootstrap_admin_password):
        return
    existing = await db.fetchval("SELECT count(*) FROM users")
    if existing and int(existing) > 0:
        return
    await db.execute(
        """INSERT INTO users (tenant_id, email, password_hash, full_name, role)
           VALUES (NULL, $1, $2, 'Platform Administrator', 'superadmin')""",
        settings.bootstrap_admin_email,
        hash_password(settings.bootstrap_admin_password),
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.connect()
    await _bootstrap_admin()
    # Start background workers: retention sweeper + notification deliverer.
    stop = asyncio.Event()
    tasks = []
    if settings.retention_enabled and settings.retention_interval_hours > 0:
        tasks.append(asyncio.create_task(retention_scheduler(stop)))
    if settings.notifications_enabled:
        tasks.append(asyncio.create_task(notification_worker(stop)))
    yield
    stop.set()
    for task in tasks:
        task.cancel()
        try:
            await task
        except (asyncio.CancelledError, Exception):
            pass
    await db.disconnect()


app = FastAPI(
    title="OpenPBX Management API",
    version="1.0.0",
    description="Multi-tenant PBX control plane (Asterisk + Twilio SIP trunking).",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routers
app.include_router(auth.router)
app.include_router(me.router)
app.include_router(tenants.router)
app.include_router(extensions.router)
app.include_router(trunks.router)
app.include_router(routes.router)
app.include_router(dids.router)
app.include_router(ringgroups.router)
app.include_router(queues.router)
app.include_router(ivr.router)
app.include_router(timeconditions.router)
app.include_router(prompts.router)
app.include_router(voicemail.router)
app.include_router(calls.router)
app.include_router(cdr.router)
app.include_router(recordings.router)
app.include_router(retention.router)
app.include_router(notifications.router)
app.include_router(notifications.internal_router)
app.include_router(status.router)


@app.get("/api/health", tags=["system"])
async def health() -> dict:
    db_ok = False
    try:
        db_ok = (await db.fetchval("SELECT 1")) == 1
    except Exception:
        db_ok = False
    return {"status": "ok", "database": db_ok, "asterisk_ari": await ari_healthy()}
