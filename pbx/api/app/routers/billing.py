"""Usage metering & billing export.

Admins see their own company's usage and invoices; super-admins can export a
platform-wide billing run across all tenants. Invoices are computed on demand
from CDR + plan; a finalized invoice can be snapshotted into `invoices`.
"""
from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel

from .. import db, stripe_client
from ..billing import (charge_invoice, compute_invoice, compute_usage,
                       ensure_stripe_customer, finalize_invoice,
                       invoice_to_csv, month_bounds, run_autofinalize)
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
    inv = await finalize_invoice(tenant_id, s, e)
    return {"status": "finalized", "period_start": s.isoformat(),
            "invoice_id": inv["invoice_id"], "total_cents": inv["total_cents"]}


@router.get("/invoices")
async def list_invoices(tenant_id: int = Depends(tenant_scope)) -> list[dict]:
    rows = await db.fetch(
        """SELECT id, period_start, period_end, currency, total_cents, status,
                  paid_at, last_error, generated_at
           FROM invoices WHERE tenant_id=$1 ORDER BY period_start DESC""",
        tenant_id)
    return [dict(r) for r in rows]


@router.post("/invoices/{invoice_id}/charge")
async def charge(invoice_id: int, tenant_id: int = Depends(tenant_scope)) -> dict:
    """Charge a finalized invoice via Stripe (admin-initiated)."""
    owns = await db.fetchval(
        "SELECT 1 FROM invoices WHERE id=$1 AND tenant_id=$2", invoice_id, tenant_id)
    if not owns:
        raise HTTPException(404, "invoice not found")
    if not stripe_client.enabled():
        raise HTTPException(400, "Stripe is not configured on this server")
    return await charge_invoice(invoice_id)


class BillingSettings(BaseModel):
    auto_bill: bool | None = None


@router.get("/settings")
async def get_billing_settings(tenant_id: int = Depends(tenant_scope)) -> dict:
    row = await db.fetchrow(
        "SELECT auto_bill, stripe_customer_id FROM tenants WHERE id=$1", tenant_id)
    return {"auto_bill": row["auto_bill"],
            "stripe_customer": bool(row["stripe_customer_id"]),
            "stripe_enabled": stripe_client.enabled()}


@router.put("/settings")
async def set_billing_settings(body: BillingSettings,
                               tenant_id: int = Depends(tenant_scope)) -> dict:
    if body.auto_bill is not None:
        await db.execute("UPDATE tenants SET auto_bill=$1 WHERE id=$2",
                         body.auto_bill, tenant_id)
        if body.auto_bill:
            await ensure_stripe_customer(tenant_id)
    return await get_billing_settings(tenant_id)


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


@platform_router.post("/autofinalize")
async def trigger_autofinalize(_: Principal = Depends(require_role("superadmin"))) -> dict:
    """Run the monthly auto-finalize now: snapshot last month's invoices for
    all active tenants and charge auto_bill ones. (Same job the scheduler runs.)"""
    return await run_autofinalize()


@platform_router.get("/runs")
async def list_billing_runs(_: Principal = Depends(require_role("superadmin")),
                            limit: int = 12) -> list[dict]:
    rows = await db.fetch(
        """SELECT id, period_start, period_end, started_at, finished_at,
                  invoices_made, charges_ok, charges_failed, error
           FROM billing_runs ORDER BY started_at DESC LIMIT $1""",
        max(1, min(limit, 100)))
    return [dict(r) for r in rows]


@platform_router.post("/webhook")
async def stripe_webhook(request: Request) -> dict:
    """Stripe webhook: reconcile invoice payment status from PaymentIntent
    events. Signature-verified; no auth (Stripe calls it). Mounted internally
    only — expose via the proxy ONLY if you point Stripe at it over TLS."""
    payload = await request.body()
    sig = request.headers.get("stripe-signature", "")
    if not stripe_client.verify_webhook(payload, sig):
        raise HTTPException(400, "invalid signature")
    import json as _json
    event = _json.loads(payload or b"{}")
    obj = event.get("data", {}).get("object", {})
    pi = obj.get("id")
    etype = event.get("type", "")
    if pi and etype in ("payment_intent.succeeded", "payment_intent.payment_failed"):
        if etype.endswith("succeeded"):
            await db.execute(
                "UPDATE invoices SET status='paid', paid_at=now(), last_error=NULL "
                "WHERE stripe_payment_intent=$1", pi)
        else:
            await db.execute(
                "UPDATE invoices SET status='failed' WHERE stripe_payment_intent=$1", pi)
    return {"received": True}
