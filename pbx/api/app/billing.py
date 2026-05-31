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
import math

from . import db


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
