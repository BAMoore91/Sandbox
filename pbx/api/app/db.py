"""Thin asyncpg connection-pool wrapper with small query helpers."""
from __future__ import annotations

from contextlib import asynccontextmanager

import asyncpg

from .config import settings

_pool: asyncpg.Pool | None = None


async def connect() -> None:
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(
            dsn=settings.dsn, min_size=2, max_size=10, command_timeout=30
        )


async def disconnect() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


def pool() -> asyncpg.Pool:
    if _pool is None:
        raise RuntimeError("DB pool not initialised")
    return _pool


async def fetch(query: str, *args) -> list[asyncpg.Record]:
    async with pool().acquire() as con:
        return await con.fetch(query, *args)


async def fetchrow(query: str, *args) -> asyncpg.Record | None:
    async with pool().acquire() as con:
        return await con.fetchrow(query, *args)


async def fetchval(query: str, *args):
    async with pool().acquire() as con:
        return await con.fetchval(query, *args)


async def execute(query: str, *args) -> str:
    async with pool().acquire() as con:
        return await con.execute(query, *args)


def tx():
    """Return a pooled connection context manager for multi-statement txns."""
    return pool().acquire()


@asynccontextmanager
async def advisory_lock(key: int):
    """Try to acquire a session-level Postgres advisory lock.

    Yields True if this process won the lock (and releases it on exit), or
    False immediately if another process already holds it. Used so that with
    multiple API replicas only one runs the retention sweep at a time.
    """
    async with pool().acquire() as con:
        got = await con.fetchval("SELECT pg_try_advisory_lock($1)", key)
        try:
            yield bool(got)
        finally:
            if got:
                await con.fetchval("SELECT pg_advisory_unlock($1)", key)
