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


async def current_user(
    creds: HTTPAuthorizationCredentials = Depends(_bearer),
) -> Principal:
    try:
        payload = decode_token(creds.credentials)
    except Exception:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired token")
    return Principal(
        user_id=int(payload["sub"]),
        tenant_id=payload.get("tid"),
        role=payload.get("role", "agent"),
    )


def require_role(*roles: str):
    async def _check(user: Principal = Depends(current_user)) -> Principal:
        if user.role not in roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Insufficient privileges")
        return user
    return _check


async def tenant_scope(tenant_id: int, user: Principal = Depends(current_user)) -> int:
    """Validate the caller may operate on `tenant_id`; return the tenant_id.

    Super-admins may act on any tenant. Tenant users only on their own.
    """
    if user.is_superadmin:
        exists = await db.fetchval("SELECT 1 FROM tenants WHERE id=$1", tenant_id)
        if not exists:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Tenant not found")
        return tenant_id
    if user.tenant_id != tenant_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Cross-tenant access denied")
    return tenant_id


async def tenant_slug(tenant_id: int = Depends(tenant_scope)) -> tuple[int, str]:
    slug = await db.fetchval("SELECT slug FROM tenants WHERE id=$1", tenant_id)
    if slug is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Tenant not found")
    return tenant_id, slug
