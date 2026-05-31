"""Usage metering & invoice computation.

An invoice for a tenant over [period_start, period_end) is derived from the
tenant's plan and its CDR in that window:

    base monthly fee
  + per-extension fee  × current active extensions
  + outbound minutes over the plan's included pool × outbound rate
  + inbound minutes (if the plan meters inbound)  × inbound rate

Minutes are billed per call: each call's billsec is rounded UP to whole
minutes (standard telecom rounding); internal calls are free.
"""
from __future__ import annotations

import datetime as dt
import json

from . import db, stripe_client
from .config import settings

BILLING_LOCK_KEY = 0x0FB1_0B11  # advisory-lock key for the auto-finalize run


def _money(cents: int) -> str:
    return f"{cents / 100:.2f}"


async def compute_usage(tenant_id: int, start: dt.date, end: dt.date) -> dict:
    """Return raw metered usage (minutes/counts) for the period [start, end)."""
    row = await db.fetchrow(
        """SELECT
             coalesce(sum(CASE WHEN direction='outbound'
                          THEN ceil(GREATEST(billsec,0)/60.0) ELSE 0 END),0)::int AS outbound_minutes,
             coalesce(sum(CASE WHEN direction='inbound'
                          THEN ceil(GREATEST(billsec,0)/60.0) ELSE 0 END),0)::int AS inbound_minutes,
             count(*) FILTER (WHERE direction='outbound') AS outbound_calls,
             count(*) FILTER (WHERE direction='inbound')  AS inbound_calls,
             count(*) FILTER (WHERE direction='internal') AS internal_calls
           FROM cdr
           WHERE tenant_id=$1 AND calldate >= $2 AND calldate < $3""",
        tenant_id, start, end)
    usage = dict(row) if row else {}
    usage["extensions"] = await db.fetchval(
        "SELECT count(*) FROM extensions WHERE tenant_id=$1", tenant_id) or 0
    return usage


async def compute_invoice(tenant_id: int, start: dt.date, end: dt.date) -> dict:
    """Compute (but do not persist) an invoice for the period [start, end)."""
    tenant = await db.fetchrow(
        """SELECT t.id, t.name, t.slug, p.code AS plan_code, p.name AS plan_name,
                  p.monthly_price_cents, p.per_extension_cents,
                  p.outbound_per_min_cents, p.inbound_per_min_cents,
                  p.included_minutes
           FROM tenants t LEFT JOIN plans p ON p.id = t.plan_id
           WHERE t.id=$1""",
        tenant_id)
    if not tenant:
        raise ValueError("tenant not found")

    usage = await compute_usage(tenant_id, start, end)
    items: list[dict] = []

    def add(label, qty, unit_cents):
        amount = int(round(qty * unit_cents))
        items.append({"label": label, "qty": qty, "unit_cents": unit_cents,
                      "amount_cents": amount})
        return amount

    total = 0
    total += add(f"{tenant['plan_name']} plan (monthly)", 1,
                 tenant["monthly_price_cents"] or 0)
    if tenant["per_extension_cents"]:
        total += add("Extensions", usage["extensions"],
                     tenant["per_extension_cents"])

    # Outbound minutes beyond the included pool.
    included = tenant["included_minutes"] or 0
    billable_out = max(0, usage["outbound_minutes"] - included)
    if tenant["outbound_per_min_cents"]:
        label = "Outbound minutes"
        if included:
            label += f" (after {included} included)"
        total += add(label, billable_out, tenant["outbound_per_min_cents"])

    if tenant["inbound_per_min_cents"]:
        total += add("Inbound minutes", usage["inbound_minutes"],
                     tenant["inbound_per_min_cents"])

    return {
        "tenant_id": tenant["id"],
        "tenant_name": tenant["name"],
        "tenant_slug": tenant["slug"],
        "plan_code": tenant["plan_code"],
        "period_start": start.isoformat(),
        "period_end": end.isoformat(),
        "currency": "USD",
        "usage": usage,
        "line_items": items,
        "total_cents": total,
        "total_display": _money(total),
    }


def invoice_to_csv(inv: dict) -> str:
    """Render an invoice as CSV (header + line items + total)."""
    import csv
    import io
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["tenant", inv["tenant_slug"]])
    w.writerow(["period", inv["period_start"], inv["period_end"]])
    w.writerow(["currency", inv["currency"]])
    w.writerow([])
    w.writerow(["label", "qty", "unit_cents", "amount_cents", "amount"])
    for it in inv["line_items"]:
        w.writerow([it["label"], it["qty"], it["unit_cents"],
                    it["amount_cents"], f"{it['amount_cents']/100:.2f}"])
    w.writerow([])
    w.writerow(["TOTAL", "", "", inv["total_cents"], inv["total_display"]])
    return buf.getvalue()


def month_bounds(year: int, month: int) -> tuple[dt.date, dt.date]:
    """Return [first day of month, first day of next month)."""
    start = dt.date(year, month, 1)
    end = dt.date(year + 1, 1, 1) if month == 12 else dt.date(year, month + 1, 1)
    return start, end


def previous_month(today: dt.date) -> tuple[int, int]:
    """(year, month) of the month before `today`."""
    return (today.year - 1, 12) if today.month == 1 else (today.year, today.month - 1)


async def finalize_invoice(tenant_id: int, start: dt.date, end: dt.date) -> dict:
    """Compute + upsert an invoice snapshot for the period. Returns the row."""
    inv = await compute_invoice(tenant_id, start, end)
    row = await db.fetchrow(
        """INSERT INTO invoices
             (tenant_id, period_start, period_end, currency, line_items, total_cents)
           VALUES ($1,$2,$3,$4,$5::jsonb,$6)
           ON CONFLICT (tenant_id, period_start, period_end) DO UPDATE SET
             line_items = EXCLUDED.line_items, total_cents = EXCLUDED.total_cents,
             generated_at = now()
           RETURNING id, status, total_cents""",
        tenant_id, start, end, inv["currency"],
        json.dumps(inv["line_items"]), inv["total_cents"])
    return {**inv, "invoice_id": row["id"], "status": row["status"]}


async def ensure_stripe_customer(tenant_id: int) -> str | None:
    """Return the tenant's Stripe customer id, creating one if needed."""
    if not stripe_client.enabled():
        return None
    t = await db.fetchrow(
        "SELECT name, billing_email, stripe_customer_id FROM tenants WHERE id=$1",
        tenant_id)
    if t["stripe_customer_id"]:
        return t["stripe_customer_id"]
    cid = await stripe_client.create_customer(t["name"], t["billing_email"])
    await db.execute("UPDATE tenants SET stripe_customer_id=$1 WHERE id=$2",
                     cid, tenant_id)
    return cid


async def charge_invoice(invoice_id: int) -> dict:
    """Charge a finalized invoice via Stripe. Idempotent on (invoice, total)."""
    inv = await db.fetchrow(
        """SELECT i.*, t.name AS tenant_name, t.slug
           FROM invoices i JOIN tenants t ON t.id = i.tenant_id WHERE i.id=$1""",
        invoice_id)
    if not inv:
        raise ValueError("invoice not found")
    if inv["status"] == "paid":
        return {"status": "paid", "invoice_id": invoice_id}
    if inv["total_cents"] <= 0:
        await db.execute(
            "UPDATE invoices SET status='paid', paid_at=now() WHERE id=$1", invoice_id)
        return {"status": "paid", "invoice_id": invoice_id, "note": "zero total"}
    if not stripe_client.enabled():
        return {"status": "open", "invoice_id": invoice_id, "note": "stripe disabled"}

    customer = await ensure_stripe_customer(inv["tenant_id"])
    if not customer:
        return {"status": "open", "invoice_id": invoice_id, "note": "no customer"}

    # idempotency key ties a charge to this invoice + amount, so retries are safe
    idem = f"inv-{invoice_id}-{inv['total_cents']}"
    res = await stripe_client.charge_off_session(
        customer, inv["total_cents"], inv["currency"],
        f"OpenPBX {inv['slug']} {inv['period_start']}", idem)

    if res["status"] == "succeeded":
        await db.execute(
            """UPDATE invoices SET status='paid', paid_at=now(),
                 stripe_payment_intent=$2, last_error=NULL WHERE id=$1""",
            invoice_id, res.get("id"))
    else:
        await db.execute(
            """UPDATE invoices SET status='failed',
                 stripe_payment_intent=$2, last_error=$3 WHERE id=$1""",
            invoice_id, res.get("id"), res.get("error", res["status"]))
    return {"status": res["status"], "invoice_id": invoice_id,
            "payment_intent": res.get("id")}


async def run_autofinalize(today: dt.date | None = None) -> dict:
    """Finalize last month's invoices for all active tenants; charge auto_bill
    ones. Records a billing_runs row. Returns a summary."""
    today = today or dt.date.today()
    y, m = previous_month(today)
    start, end = month_bounds(y, m)
    run_id = await db.fetchval(
        "INSERT INTO billing_runs (period_start, period_end) VALUES ($1,$2) RETURNING id",
        start, end)
    made = ok = failed = 0
    error = None
    try:
        tenants = await db.fetch(
            "SELECT id, auto_bill FROM tenants WHERE status='active' ORDER BY id")
        for t in tenants:
            inv = await finalize_invoice(t["id"], start, end)
            made += 1
            if t["auto_bill"] and inv["total_cents"] > 0:
                res = await charge_invoice(inv["invoice_id"])
                if res["status"] in ("paid", "succeeded"):
                    ok += 1
                elif res["status"] in ("failed",):
                    failed += 1
    except Exception as exc:  # pragma: no cover - defensive
        error = str(exc)[:500]
    await db.execute(
        """UPDATE billing_runs SET finished_at=now(), invoices_made=$2,
             charges_ok=$3, charges_failed=$4, error=$5 WHERE id=$1""",
        run_id, made, ok, failed, error)
    return {"period_start": start.isoformat(), "period_end": end.isoformat(),
            "invoices_made": made, "charges_ok": ok, "charges_failed": failed,
            "error": error}


async def autofinalize_scheduler(stop) -> None:
    """Wake periodically; on billing_run_day run auto-finalize once (advisory-
    locked, and guarded so it runs at most once per period)."""
    import asyncio
    interval = settings.billing_check_hours * 3600
    while not stop.is_set():
        try:
            today = dt.date.today()
            if today.day == settings.billing_run_day:
                y, m = previous_month(today)
                start, _ = month_bounds(y, m)
                async with db.advisory_lock(BILLING_LOCK_KEY) as got:
                    if got:
                        already = await db.fetchval(
                            "SELECT 1 FROM billing_runs WHERE period_start=$1 "
                            "AND finished_at IS NOT NULL", start)
                        if not already:
                            await run_autofinalize(today)
        except Exception:
            pass
        try:
            await asyncio.wait_for(stop.wait(), timeout=interval)
        except asyncio.TimeoutError:
            continue
