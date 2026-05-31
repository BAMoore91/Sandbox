"""Usage metering & billing export.

Admins see their own company's usage and invoices; super-admins can export a
platform-wide billing run across all tenants. Invoices are computed on demand
from CDR + plan; a finalized invoice can be snapshotted into `invoices`.
"""
from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import PlainTextResponse

from .. import db
from ..billing import (compute_invoice, compute_usage, invoice_to_csv,
                       month_bounds)
from ..deps import Principal, require_role, tenant_scope

router = APIRouter(prefix="/api/tenants/{tenant_id}/billing", tags=["billing"])


def _resolve_period(year: int | None, month: int | None,
                    start: str | None, end: str | None) -> tuple[dt.date, dt.date]:
    """Period from either (year, month) or explicit start/end ISO dates.
    Defaults to the current calendar month."""
    if start and end:
        try:
            return dt.date.fromisoformat(start), dt.date.fromisoformat(end)
        except ValueError:
            raise HTTPException(422, "start/end must be ISO dates (YYYY-MM-DD)")
    today = dt.date.today()
    y, m = year or today.year, month or today.month
    if not (1 <= m <= 12):
        raise HTTPException(422, "month must be 1-12")
    return month_bounds(y, m)


@router.get("/usage")
async def usage(tenant_id: int = Depends(tenant_scope),
                year: int | None = None, month: int | None = None,
                start: str | None = None, end: str | None = None) -> dict:
    s, e = _resolve_period(year, month, start, end)
    return {"period_start": s.isoformat(), "period_end": e.isoformat(),
            **await compute_usage(tenant_id, s, e)}


@router.get("/invoice")
async def invoice(tenant_id: int = Depends(tenant_scope),
                  year: int | None = None, month: int | None = None,
                  start: str | None = None, end: str | None = None,
                  format: str = Query("json", pattern="^(json|csv)$")):
    s, e = _resolve_period(year, month, start, end)
    inv = await compute_invoice(tenant_id, s, e)
    if format == "csv":
        fname = f"invoice-{inv['tenant_slug']}-{s.isoformat()}.csv"
        return PlainTextResponse(
            invoice_to_csv(inv), media_type="text/csv",
            headers={"Content-Disposition": f'attachment; filename="{fname}"'})
    return inv


@router.post("/invoice/finalize")
async def finalize(tenant_id: int = Depends(tenant_scope),
                   year: int | None = None, month: int | None = None) -> dict:
    """Snapshot the period's invoice into `invoices` (idempotent per period)."""
    s, e = _resolve_period(year, month, None, None)
    inv = await compute_invoice(tenant_id, s, e)
    import json
    await db.execute(
        """INSERT INTO invoices
             (tenant_id, period_start, period_end, currency, line_items, total_cents)
           VALUES ($1,$2,$3,$4,$5::jsonb,$6)
           ON CONFLICT (tenant_id, period_start, period_end) DO UPDATE SET
             line_items = EXCLUDED.line_items, total_cents = EXCLUDED.total_cents,
             generated_at = now()""",
        tenant_id, s, e, inv["currency"], json.dumps(inv["line_items"]),
        inv["total_cents"])
    return {"status": "finalized", "period_start": s.isoformat(),
            "total_cents": inv["total_cents"]}


@router.get("/invoices")
async def list_invoices(tenant_id: int = Depends(tenant_scope)) -> list[dict]:
    rows = await db.fetch(
        """SELECT id, period_start, period_end, currency, total_cents, generated_at
           FROM invoices WHERE tenant_id=$1 ORDER BY period_start DESC""",
        tenant_id)
    return [dict(r) for r in rows]


# ---- Platform-wide export (super-admin) -----------------------------------
platform_router = APIRouter(prefix="/api/billing", tags=["billing"])


@platform_router.get("/run")
async def platform_run(_: Principal = Depends(require_role("superadmin")),
                       year: int | None = None, month: int | None = None,
                       format: str = Query("json", pattern="^(json|csv)$")):
    """Compute invoices for every active tenant for a month (billing run)."""
    s, e = _resolve_period(year, month, None, None)
    tenants = await db.fetch(
        "SELECT id FROM tenants WHERE status='active' ORDER BY id")
    invoices = [await compute_invoice(t["id"], s, e) for t in tenants]
    grand_total = sum(i["total_cents"] for i in invoices)

    if format == "csv":
        import csv
        import io
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(["tenant_slug", "tenant_name", "plan", "period_start",
                    "period_end", "outbound_min", "inbound_min", "extensions",
                    "total_cents", "total"])
        for i in invoices:
            u = i["usage"]
            w.writerow([i["tenant_slug"], i["tenant_name"], i["plan_code"],
                        i["period_start"], i["period_end"],
                        u["outbound_minutes"], u["inbound_minutes"],
                        u["extensions"], i["total_cents"], i["total_display"]])
        w.writerow([])
        w.writerow(["GRAND TOTAL", "", "", s.isoformat(), e.isoformat(),
                    "", "", "", grand_total, f"{grand_total/100:.2f}"])
        fname = f"billing-run-{s.isoformat()}.csv"
        return PlainTextResponse(
            buf.getvalue(), media_type="text/csv",
            headers={"Content-Disposition": f'attachment; filename="{fname}"'})

    return {"period_start": s.isoformat(), "period_end": e.isoformat(),
            "tenant_count": len(invoices), "grand_total_cents": grand_total,
            "invoices": invoices}
