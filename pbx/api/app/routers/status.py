"""Live status: SIP registrations + trunk health, scoped per tenant."""
from __future__ import annotations

from fastapi import APIRouter, Depends

from .. import db
from ..deps import tenant_scope_read

router = APIRouter(prefix="/api/tenants/{tenant_id}/status", tags=["status"])


@router.get("/registrations")
async def registrations(tenant_id: int = Depends(tenant_scope_read)) -> list[dict]:
    """Which of the tenant's extensions currently have a live SIP contact."""
    rows = await db.fetch(
        """SELECT e.extension, e.display_name, e.endpoint_id,
                  c.uri, c.user_agent, c.expiration_time,
                  (c.id IS NOT NULL) AS online
           FROM extensions e
           LEFT JOIN ps_contacts c ON c.endpoint = e.endpoint_id
           WHERE e.tenant_id = $1
           ORDER BY e.extension""",
        tenant_id,
    )
    return [dict(r) for r in rows]


@router.get("/trunks")
async def trunk_status(tenant_id: int = Depends(tenant_scope_read)) -> list[dict]:
    rows = await db.fetch(
        """SELECT id, name, provider, sip_server, enabled, endpoint_id
           FROM trunks WHERE tenant_id = $1 OR tenant_id IS NULL ORDER BY id""",
        tenant_id,
    )
    return [dict(r) for r in rows]
