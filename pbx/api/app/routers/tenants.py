"""Tenant (company) lifecycle + plans + tenant users. Super-admin territory,
except a tenant admin may read/update their own tenant and manage its users.
"""
from __future__ import annotations

import re

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr

from .. import db
from ..deps import Principal, current_user, require_role, tenant_scope
from ..security import hash_password

router = APIRouter(prefix="/api", tags=["tenants"])

_SLUG_RE = re.compile(r"^[a-z][a-z0-9-]{1,38}[a-z0-9]$")


class TenantIn(BaseModel):
    slug: str
    name: str
    plan_code: str = "startup"
    timezone: str = "America/New_York"
    billing_email: EmailStr | None = None
    admin_email: EmailStr | None = None      # optionally create the first tenant admin
    admin_password: str | None = None
    admin_name: str | None = None


class TenantPatch(BaseModel):
    name: str | None = None
    plan_code: str | None = None
    status: str | None = None
    timezone: str | None = None
    billing_email: EmailStr | None = None


# ---- Plans ----------------------------------------------------------------
@router.get("/plans")
async def list_plans(_: Principal = Depends(current_user)) -> list[dict]:
    rows = await db.fetch("SELECT * FROM plans ORDER BY monthly_price_cents")
    return [dict(r) for r in rows]


# ---- Tenants --------------------------------------------------------------
@router.get("/tenants")
async def list_tenants(user: Principal = Depends(current_user)) -> list[dict]:
    if user.is_superadmin:
        rows = await db.fetch(
            """SELECT t.*, p.name AS plan_name,
                      (SELECT count(*) FROM extensions e WHERE e.tenant_id = t.id) AS ext_count
               FROM tenants t LEFT JOIN plans p ON p.id = t.plan_id
               ORDER BY t.created_at DESC"""
        )
    else:
        rows = await db.fetch(
            """SELECT t.*, p.name AS plan_name,
                      (SELECT count(*) FROM extensions e WHERE e.tenant_id = t.id) AS ext_count
               FROM tenants t LEFT JOIN plans p ON p.id = t.plan_id
               WHERE t.id = $1""",
            user.tenant_id,
        )
    return [dict(r) for r in rows]


@router.post("/tenants", status_code=201)
async def create_tenant(body: TenantIn,
                        _: Principal = Depends(require_role("superadmin"))) -> dict:
    if not _SLUG_RE.match(body.slug):
        raise HTTPException(422, "slug must be lowercase dns-safe (a-z, 0-9, -)")
    plan = await db.fetchrow("SELECT id FROM plans WHERE code = $1", body.plan_code)
    if not plan:
        raise HTTPException(422, "unknown plan_code")

    async with db.tx() as con:
        async with con.transaction():
            exists = await con.fetchval("SELECT 1 FROM tenants WHERE slug = $1", body.slug)
            if exists:
                raise HTTPException(409, "slug already in use")
            tid = await con.fetchval(
                """INSERT INTO tenants (slug, name, plan_id, timezone, billing_email)
                   VALUES ($1, $2, $3, $4, $5) RETURNING id""",
                body.slug, body.name, plan["id"], body.timezone, body.billing_email,
            )
            if body.admin_email and body.admin_password:
                await con.execute(
                    """INSERT INTO users (tenant_id, email, password_hash, full_name, role)
                       VALUES ($1, $2, $3, $4, 'admin')""",
                    tid, body.admin_email, hash_password(body.admin_password),
                    body.admin_name or "Administrator",
                )
    row = await db.fetchrow("SELECT * FROM tenants WHERE id = $1", tid)
    return dict(row)


@router.get("/tenants/{tenant_id}")
async def get_tenant(tenant_id: int = Depends(tenant_scope)) -> dict:
    row = await db.fetchrow(
        """SELECT t.*, p.name AS plan_name, p.code AS plan_code,
                  p.max_extensions, p.features
           FROM tenants t LEFT JOIN plans p ON p.id = t.plan_id WHERE t.id = $1""",
        tenant_id,
    )
    return dict(row)


@router.patch("/tenants/{tenant_id}")
async def update_tenant(body: TenantPatch,
                        tenant_id: int = Depends(tenant_scope)) -> dict:
    sets, vals = [], []
    for field in ("name", "status", "timezone", "billing_email"):
        v = getattr(body, field)
        if v is not None:
            vals.append(v)
            sets.append(f"{field} = ${len(vals)}")
    if body.plan_code is not None:
        pid = await db.fetchval("SELECT id FROM plans WHERE code = $1", body.plan_code)
        if not pid:
            raise HTTPException(422, "unknown plan_code")
        vals.append(pid)
        sets.append(f"plan_id = ${len(vals)}")
    if not sets:
        raise HTTPException(422, "no fields to update")
    vals.append(tenant_id)
    await db.execute(
        f"UPDATE tenants SET {', '.join(sets)}, updated_at = now() WHERE id = ${len(vals)}",
        *vals,
    )
    return dict(await db.fetchrow("SELECT * FROM tenants WHERE id = $1", tenant_id))


@router.post("/tenants/{tenant_id}/suspend")
async def suspend_tenant(tenant_id: int,
                         _: Principal = Depends(require_role("superadmin"))) -> dict:
    await db.execute("UPDATE tenants SET status='suspended' WHERE id=$1", tenant_id)
    return {"status": "suspended"}


@router.delete("/tenants/{tenant_id}", status_code=204)
async def delete_tenant(tenant_id: int,
                        _: Principal = Depends(require_role("superadmin"))):
    # ON DELETE CASCADE removes extensions/features; clean PJSIP rows too.
    await db.execute(
        "DELETE FROM ps_endpoints WHERE tenant_id = $1", tenant_id)
    await db.execute("DELETE FROM ps_auths WHERE tenant_id = $1", tenant_id)
    await db.execute("DELETE FROM ps_aors WHERE tenant_id = $1", tenant_id)
    await db.execute("DELETE FROM voicemail WHERE tenant_id = $1", tenant_id)
    await db.execute("DELETE FROM tenants WHERE id = $1", tenant_id)


# ---- Tenant users ---------------------------------------------------------
class UserIn(BaseModel):
    email: EmailStr
    password: str
    full_name: str | None = None
    role: str = "agent"               # admin | agent
    extension: str | None = None      # link to this extension number (agents)


class UserPatch(BaseModel):
    full_name: str | None = None
    role: str | None = None
    password: str | None = None
    is_active: bool | None = None
    extension: str | None = None      # "" to unlink


async def _extension_id_for(tenant_id: int, number: str | None) -> int | None:
    """Resolve an extension number to its id within the tenant (or None)."""
    if not number:
        return None
    eid = await db.fetchval(
        "SELECT id FROM extensions WHERE tenant_id=$1 AND extension=$2",
        tenant_id, number)
    if eid is None:
        raise HTTPException(422, f"extension {number} not found in this company")
    return eid


@router.get("/tenants/{tenant_id}/users")
async def list_users(tenant_id: int = Depends(tenant_scope)) -> list[dict]:
    rows = await db.fetch(
        """SELECT u.id, u.email, u.full_name, u.role, u.extension_id,
                  e.extension AS extension, u.is_active, u.last_login_at
           FROM users u
           LEFT JOIN extensions e ON e.id = u.extension_id
           WHERE u.tenant_id = $1 ORDER BY u.role, u.email""",
        tenant_id,
    )
    return [dict(r) for r in rows]


@router.post("/tenants/{tenant_id}/users", status_code=201)
async def create_user(body: UserIn, tenant_id: int = Depends(tenant_scope)) -> dict:
    if body.role not in ("admin", "agent"):
        raise HTTPException(422, "role must be admin or agent")
    ext_id = await _extension_id_for(tenant_id, body.extension)
    try:
        uid = await db.fetchval(
            """INSERT INTO users (tenant_id, email, password_hash, full_name, role, extension_id)
               VALUES ($1, $2, $3, $4, $5, $6) RETURNING id""",
            tenant_id, body.email, hash_password(body.password),
            body.full_name, body.role, ext_id,
        )
    except Exception:
        raise HTTPException(409, "email already in use for this tenant")
    return {"id": uid}


@router.patch("/tenants/{tenant_id}/users/{user_id}")
async def update_user(user_id: int, body: UserPatch,
                      tenant_id: int = Depends(tenant_scope)) -> dict:
    owned = await db.fetchval(
        "SELECT 1 FROM users WHERE id=$1 AND tenant_id=$2", user_id, tenant_id)
    if not owned:
        raise HTTPException(404, "user not found")

    sets, vals = [], []
    if body.full_name is not None:
        vals.append(body.full_name); sets.append(f"full_name = ${len(vals)}")
    if body.role is not None:
        if body.role not in ("admin", "agent"):
            raise HTTPException(422, "role must be admin or agent")
        vals.append(body.role); sets.append(f"role = ${len(vals)}")
    if body.is_active is not None:
        vals.append(body.is_active); sets.append(f"is_active = ${len(vals)}")
    if body.password:
        vals.append(hash_password(body.password)); sets.append(f"password_hash = ${len(vals)}")
    if body.extension is not None:
        # empty string unlinks; otherwise resolve+validate within tenant
        ext_id = await _extension_id_for(tenant_id, body.extension or None)
        vals.append(ext_id); sets.append(f"extension_id = ${len(vals)}")
    if not sets:
        raise HTTPException(422, "no fields to update")
    vals += [user_id, tenant_id]
    await db.execute(
        f"UPDATE users SET {', '.join(sets)} "
        f"WHERE id = ${len(vals)-1} AND tenant_id = ${len(vals)}", *vals)
    return {"id": user_id, "status": "updated"}


@router.delete("/tenants/{tenant_id}/users/{user_id}", status_code=204)
async def delete_user(user_id: int, tenant_id: int = Depends(tenant_scope)):
    await db.execute(
        "DELETE FROM users WHERE id = $1 AND tenant_id = $2", user_id, tenant_id)
