"""Authentication: login + profile."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr

from .. import db
from ..deps import Principal, current_user
from ..security import create_access_token, verify_password

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginIn(BaseModel):
    email: EmailStr
    password: str
    tenant_slug: str | None = None   # required for tenant users; omit for super-admin


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: str
    tenant_id: int | None
    full_name: str | None


@router.post("/login", response_model=TokenOut)
async def login(body: LoginIn) -> TokenOut:
    if body.tenant_slug:
        row = await db.fetchrow(
            """SELECT u.* FROM users u JOIN tenants t ON t.id = u.tenant_id
               WHERE u.email = $1 AND t.slug = $2 AND u.is_active""",
            body.email, body.tenant_slug,
        )
    else:
        row = await db.fetchrow(
            "SELECT * FROM users WHERE email = $1 AND tenant_id IS NULL AND is_active",
            body.email,
        )
    if not row or not verify_password(body.password, row["password_hash"]):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid credentials")

    await db.execute("UPDATE users SET last_login_at = now() WHERE id = $1", row["id"])
    token = create_access_token(
        user_id=row["id"], tenant_id=row["tenant_id"], role=row["role"]
    )
    return TokenOut(
        access_token=token, role=row["role"],
        tenant_id=row["tenant_id"], full_name=row["full_name"],
    )


@router.get("/me")
async def me(user: Principal = Depends(current_user)) -> dict:
    row = await db.fetchrow(
        "SELECT id, email, full_name, role, tenant_id FROM users WHERE id = $1",
        user.user_id,
    )
    return dict(row) if row else {}
