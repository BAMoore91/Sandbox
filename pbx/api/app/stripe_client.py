"""Minimal Stripe REST client (httpx) — no SDK dependency.

Covers what billing needs: ensure a Customer exists, and create+confirm a
PaymentIntent off-session against the customer's default payment method.
Charging is a no-op (returns disabled) when no secret key is configured.
"""
from __future__ import annotations

import hashlib
import hmac
import time

import httpx

from .config import settings

_BASE = "https://api.stripe.com/v1"


def enabled() -> bool:
    return bool(settings.stripe_secret_key)


def _auth() -> tuple[str, str]:
    return (settings.stripe_secret_key, "")


async def create_customer(name: str, email: str | None) -> str:
    """Create a Stripe Customer, returning its id."""
    data = {"name": name}
    if email:
        data["email"] = email
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.post(f"{_BASE}/customers", data=data, auth=_auth())
        r.raise_for_status()
        return r.json()["id"]


async def charge_off_session(customer_id: str, amount_cents: int, currency: str,
                             description: str, idempotency_key: str) -> dict:
    """Create + confirm an off-session PaymentIntent for an existing customer.

    Returns {"status": "succeeded"|..., "id": pi_...}. Raises on hard errors;
    a declined card surfaces as a non-succeeded status (and Stripe 402).
    """
    data = {
        "amount": str(amount_cents),
        "currency": currency.lower(),
        "customer": customer_id,
        "description": description,
        "confirm": "true",
        "off_session": "true",
    }
    headers = {"Idempotency-Key": idempotency_key}
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(f"{_BASE}/payment_intents", data=data,
                              headers=headers, auth=_auth())
        body = r.json()
        if r.status_code >= 400:
            # card errors include the payment_intent under error.payment_intent
            err = body.get("error", {})
            pi = err.get("payment_intent", {})
            return {"status": pi.get("status", "failed"),
                    "id": pi.get("id"), "error": err.get("message", r.text[:200])}
        return {"status": body.get("status"), "id": body.get("id")}


def verify_webhook(payload: bytes, sig_header: str) -> bool:
    """Verify a Stripe webhook signature (t=…,v1=…) against the configured secret."""
    secret = settings.stripe_webhook_secret
    if not secret or not sig_header:
        return False
    parts = dict(p.split("=", 1) for p in sig_header.split(",") if "=" in p)
    ts, v1 = parts.get("t"), parts.get("v1")
    if not ts or not v1:
        return False
    # reject stale timestamps (>5 min) to blunt replay
    try:
        if abs(time.time() - int(ts)) > 300:
            return False
    except ValueError:
        return False
    signed = f"{ts}.".encode() + payload
    expected = hmac.new(secret.encode(), signed, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, v1)
