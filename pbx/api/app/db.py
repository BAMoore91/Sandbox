"""Thin asyncpg connection-pool wrapper with small query helpers."""
from __future__ import annotations

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
