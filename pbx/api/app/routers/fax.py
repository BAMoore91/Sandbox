"""Fax management: per-DID fax boxes (inbound fax-to-email), outbound send-fax
(PDF upload), and job history."""
from __future__ import annotations

import os

from fastapi import (APIRouter, Depends, File, Form, HTTPException, UploadFile)
from fastapi.responses import FileResponse
from pydantic import BaseModel

from .. import db, fax as faxlib
from ..config import settings
from ..deps import tenant_scope, tenant_slug

router = APIRouter(prefix="/api/tenants/{tenant_id}/fax", tags=["fax"])


# ---- Fax boxes (inbound destinations) -------------------------------------
class FaxBoxIn(BaseModel):
    number: str
    name: str | None = None
    email: str | None = None         # comma-separated recipients
    header: str | None = None
    enabled: bool = True


@router.get("/boxes")
async def list_boxes(tenant_id: int = Depends(tenant_scope)) -> list[dict]:
    rows = await db.fetch(
        """SELECT id, number, name, email, header, enabled
           FROM fax_boxes WHERE tenant_id=$1 ORDER BY number""", tenant_id)
    return [dict(r) for r in rows]


@router.post("/boxes", status_code=201)
async def create_box(body: FaxBoxIn, tenant_id: int = Depends(tenant_scope)) -> dict:
    try:
        bid = await db.fetchval(
            """INSERT INTO fax_boxes (tenant_id, number, name, email, header, enabled)
               VALUES ($1,$2,$3,$4,$5,$6) RETURNING id""",
            tenant_id, body.number, body.name, body.email, body.header, body.enabled)
    except Exception:
        raise HTTPException(409, "fax box number already exists")
    return {"id": bid}


@router.put("/boxes/{box_id}")
async def update_box(box_id: int, body: FaxBoxIn,
                     tenant_id: int = Depends(tenant_scope)) -> dict:
    res = await db.execute(
        """UPDATE fax_boxes SET number=$3, name=$4, email=$5, header=$6, enabled=$7
           WHERE id=$1 AND tenant_id=$2""",
        box_id, tenant_id, body.number, body.name, body.email, body.header, body.enabled)
    if res.endswith("0"):
        raise HTTPException(404, "fax box not found")
    return {"id": box_id, "status": "updated"}


@router.delete("/boxes/{box_id}", status_code=204)
async def delete_box(box_id: int, tenant_id: int = Depends(tenant_scope)):
    await db.execute("DELETE FROM fax_boxes WHERE id=$1 AND tenant_id=$2",
                     box_id, tenant_id)


# ---- Outbound send-fax (PDF upload) ---------------------------------------
@router.post("/send", status_code=201)
async def send_fax(
    ts: tuple[int, str] = Depends(tenant_slug),
    to_number: str = Form(...),
    caller_id: str = Form(...),
    header: str | None = Form(None),
    trunk_id: int | None = Form(None),
    file: UploadFile = File(...),
) -> dict:
    tid, slug = ts
    if not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(422, "only PDF uploads are supported")
    raw = await file.read()
    if not raw:
        raise HTTPException(422, "empty file")

    # resolve the trunk endpoint (explicit, else tenant default, else any enabled)
    trow = await db.fetchrow(
        """SELECT endpoint_id FROM trunks
           WHERE enabled AND (tenant_id=$1 OR tenant_id IS NULL)
             AND ($2::int IS NULL OR id=$2)
           ORDER BY (tenant_id=$1) DESC, id LIMIT 1""",
        tid, trunk_id)
    if not trow:
        raise HTTPException(422, "no enabled trunk available to send the fax")

    tenant_dir = os.path.join(settings.fax_dir, slug)
    os.makedirs(tenant_dir, exist_ok=True)
    import secrets
    pdf_path = os.path.join(tenant_dir, f"out-{secrets.token_hex(6)}.pdf")
    with open(pdf_path, "wb") as fh:
        fh.write(raw)

    try:
        fax_id = await faxlib.send_fax(
            tenant_id=tid, slug=slug, to_number=to_number, pdf_path=pdf_path,
            caller_id=caller_id, header=header or "", trunk_endpoint=trow["endpoint_id"])
    except Exception as exc:
        raise HTTPException(502, f"send failed: {exc}")
    return {"fax_id": fax_id, "status": "sending"}


# ---- Job history + PDF download -------------------------------------------
@router.get("")
async def list_faxes(tenant_id: int = Depends(tenant_scope),
                     direction: str | None = None, limit: int = 100) -> list[dict]:
    where = ["tenant_id=$1"]
    args: list = [tenant_id]
    if direction in ("inbound", "outbound"):
        args.append(direction)
        where.append(f"direction=${len(args)}")
    args.append(max(1, min(limit, 500)))
    rows = await db.fetch(
        f"""SELECT id, direction, faxbox, src, dst, status, pages, error,
                   created_at, completed_at, (pdf_path IS NOT NULL) AS has_pdf
            FROM faxes WHERE {' AND '.join(where)}
            ORDER BY created_at DESC LIMIT ${len(args)}""", *args)
    return [dict(r) for r in rows]


@router.get("/{fax_id}/pdf")
async def fax_pdf(fax_id: int, tenant_id: int = Depends(tenant_scope)):
    row = await db.fetchrow(
        "SELECT pdf_path FROM faxes WHERE id=$1 AND tenant_id=$2", fax_id, tenant_id)
    if not row or not row["pdf_path"]:
        raise HTTPException(404, "no PDF for this fax")
    path = row["pdf_path"]
    # map an Asterisk spool path to the API mount if needed
    marker = "/var/spool/asterisk/fax/"
    if path.startswith(marker):
        path = os.path.join(settings.fax_dir, path[len(marker):])
    if not os.path.exists(path):
        raise HTTPException(404, "fax file not found")
    return FileResponse(path, media_type="application/pdf",
                        filename=f"fax-{fax_id}.pdf")
