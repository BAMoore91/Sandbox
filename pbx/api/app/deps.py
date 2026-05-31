"""Auth + tenant-scoping dependencies shared by routers."""
from __future__ import annotations

from dataclasses import dataclass

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from . import db
from .security import decode_token

_bearer = HTTPBearer(auto_error=True)


@dataclass
class Principal:
    user_id: int
    tenant_id: int | None     # None == platform super-admin
    role: str                  # superadmin | admin | agent

    @property
    def is_superadmin(self) -> bool:
        return self.role == "superadmin" and self.tenant_id is None

    @property
    def is_admin(self) -> bool:
        """Tenant administrator (or platform super-admin)."""
        return self.role in ("admin", "superadmin")


async def current_user(
    creds: HTTPAuthorizationCredentials = Depends(_bearer),
) -> Principal:
    try:
        payload = decode_token(creds.credentials)
    except Exception:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired token")

    # The JWT identifies the user; authoritative role/tenant/active state is
    # re-read from the DB on every request, so promote/demote/disable take
    # effect immediately rather than at next login (token expiry).
    row = await db.fetchrow(
        "SELECT tenant_id, role, is_active FROM users WHERE id = $1",
        int(payload["sub"]),
    )
    if row is None or not row["is_active"]:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED, "Account disabled or no longer exists"
        )
    return Principal(
        user_id=int(payload["sub"]),
        tenant_id=row["tenant_id"],
        role=row["role"],
    )


def require_role(*roles: str):
    async def _check(user: Principal = Depends(current_user)) -> Principal:
        if user.role not in roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Insufficient privileges")
        return user
    return _check


async def _check_tenant_membership(tenant_id: int, user: Principal) -> int:
    """Confirm the caller belongs to (or super-admins) `tenant_id`."""
    if user.is_superadmin:
        if not await db.fetchval("SELECT 1 FROM tenants WHERE id=$1", tenant_id):
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Tenant not found")
        return tenant_id
    if user.tenant_id != tenant_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Cross-tenant access denied")
    return tenant_id


async def tenant_scope(tenant_id: int, user: Principal = Depends(current_user)) -> int:
    """Admin-only tenant scope for configuration endpoints.

    Super-admins may act on any tenant; tenant admins only on their own.
    Agents are denied — the config surface (extensions, IVRs, trunks, routing,
    prompts, …) is reserved for administrators. Agents use the /api/me/*
    self-service endpoints instead.
    """
    await _check_tenant_membership(tenant_id, user)
    if not user.is_admin:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Administrator role required to manage company settings",
        )
    return tenant_id


async def tenant_scope_read(tenant_id: int, user: Principal = Depends(current_user)) -> int:
    """Membership-only tenant scope (no admin requirement).

    Use for read endpoints any tenant member — including agents — may see,
    such as the dashboard/status panels.
    """
    return await _check_tenant_membership(tenant_id, user)


async def tenant_slug(tenant_id: int = Depends(tenant_scope)) -> tuple[int, str]:
    slug = await db.fetchval("SELECT slug FROM tenants WHERE id=$1", tenant_id)
    if slug is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Tenant not found")
    return tenant_id, slug
