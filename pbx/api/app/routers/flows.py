"""Flows — Studio-style visual call flows: CRUD, validation, test-run, and
execution/recording/webhook history."""
from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from .. import db
from ..deps import tenant_scope
from ..flow_engine import FlowRunner, validate_definition

router = APIRouter(prefix="/api/tenants/{tenant_id}/flows", tags=["flows"])


class FlowIn(BaseModel):
    number: str
    name: str | None = None
    definition: dict
    enabled: bool = True


@router.get("")
async def list_flows(tenant_id: int = Depends(tenant_scope)) -> list[dict]:
    rows = await db.fetch(
        """SELECT id, number, name, enabled, created_at, updated_at
           FROM flows WHERE tenant_id=$1 ORDER BY number""", tenant_id)
    return [dict(r) for r in rows]


@router.get("/{flow_id}")
async def get_flow(flow_id: int, tenant_id: int = Depends(tenant_scope)) -> dict:
    row = await db.fetchrow(
        "SELECT * FROM flows WHERE id=$1 AND tenant_id=$2", flow_id, tenant_id)
    if not row:
        raise HTTPException(404, "flow not found")
    d = dict(row)
    d["definition"] = json.loads(d["definition"]) if isinstance(d["definition"], str) \
        else d["definition"]
    return d


@router.post("", status_code=201)
async def create_flow(body: FlowIn, tenant_id: int = Depends(tenant_scope)) -> dict:
    errs = validate_definition(body.definition)
    if errs:
        raise HTTPException(422, {"errors": errs})
    try:
        fid = await db.fetchval(
            """INSERT INTO flows (tenant_id, number, name, definition, enabled)
               VALUES ($1,$2,$3,$4::jsonb,$5) RETURNING id""",
            tenant_id, body.number, body.name, json.dumps(body.definition),
            body.enabled)
    except Exception:
        raise HTTPException(409, "flow number already exists")
    return {"id": fid}


@router.put("/{flow_id}")
async def update_flow(flow_id: int, body: FlowIn,
                      tenant_id: int = Depends(tenant_scope)) -> dict:
    errs = validate_definition(body.definition)
    if errs:
        raise HTTPException(422, {"errors": errs})
    res = await db.execute(
        """UPDATE flows SET number=$3, name=$4, definition=$5::jsonb, enabled=$6,
             updated_at=now() WHERE id=$1 AND tenant_id=$2""",
        flow_id, tenant_id, body.number, body.name, json.dumps(body.definition),
        body.enabled)
    if res.endswith("0"):
        raise HTTPException(404, "flow not found")
    return {"id": flow_id, "status": "updated"}


@router.delete("/{flow_id}", status_code=204)
async def delete_flow(flow_id: int, tenant_id: int = Depends(tenant_scope)):
    await db.execute("DELETE FROM flows WHERE id=$1 AND tenant_id=$2",
                     flow_id, tenant_id)


class ValidateIn(BaseModel):
    definition: dict


@router.post("/validate")
async def validate(body: ValidateIn, _: int = Depends(tenant_scope)) -> dict:
    errs = validate_definition(body.definition)
    return {"valid": not errs, "errors": errs}


class TestIn(BaseModel):
    definition: dict | None = None      # test an unsaved definition, or...
    flow_id: int | None = None          # ...a saved one
    digits: list[str] = []              # scripted DTMF answers for gather widgets
    variables: dict = {}                # seed variables (caller, did, …)


@router.post("/test")
async def test_run(body: TestIn, tenant_id: int = Depends(tenant_scope)) -> dict:
    """Dry-run a flow with a scripted channel (no telephony). Webhooks DO run
    so you can verify GET/POST integrations; media actions are simulated and
    recorded into a trace. `digits` answers gather widgets in order."""
    if body.flow_id is not None:
        row = await db.fetchrow(
            "SELECT definition FROM flows WHERE id=$1 AND tenant_id=$2",
            body.flow_id, tenant_id)
        if not row:
            raise HTTPException(404, "flow not found")
        defn = json.loads(row["definition"]) if isinstance(row["definition"], str) \
            else row["definition"]
    elif body.definition is not None:
        defn = body.definition
    else:
        raise HTTPException(422, "provide flow_id or definition")

    errs = validate_definition(defn)
    if errs:
        raise HTTPException(422, {"errors": errs})

    trace: list[dict] = []
    digits_iter = iter(body.digits)

    class MockChannel:
        async def say(self, text):
            trace.append({"action": "say", "text": text})

        async def gather(self, text, num_digits, timeout):
            if text:
                trace.append({"action": "say", "text": text})
            try:
                d = next(digits_iter)
            except StopIteration:
                d = ""
            trace.append({"action": "gather", "digits": d})
            return d

        async def record(self, max_seconds):
            trace.append({"action": "record", "max_seconds": max_seconds})
            return {"path": "test/sim.wav", "duration": 0}

        async def dial(self, dest_value, timeout):
            trace.append({"action": "dial", "dest": dest_value})
            return "ANSWER"

        async def dispatch(self, dest_type, dest_value):
            trace.append({"action": "route", "dest_type": dest_type,
                          "dest_value": dest_value})

        async def hangup(self):
            trace.append({"action": "hangup"})

    runner = FlowRunner(defn, MockChannel(),
                        variables={"caller": "+15555550123", "did": "test",
                                   **body.variables})
    try:
        result = await runner.run()
    except Exception as exc:
        raise HTTPException(422, f"flow error: {exc}")
    return {"trace": trace, "path": result["path"],
            "variables": result["variables"], "webhook_log": result["webhook_log"]}


# ---- Execution history -----------------------------------------------------
@router.get("/{flow_id}/executions")
async def executions(flow_id: int, tenant_id: int = Depends(tenant_scope),
                     limit: int = 50) -> list[dict]:
    rows = await db.fetch(
        """SELECT id, channel_id, caller, did, status, path, error,
                  started_at, ended_at
           FROM flow_executions
           WHERE flow_id=$1 AND tenant_id=$2
           ORDER BY started_at DESC LIMIT $3""",
        flow_id, tenant_id, max(1, min(limit, 200)))
    return [dict(r) for r in rows]


@router.get("/executions/{execution_id}/recordings")
async def execution_recordings(execution_id: int,
                               tenant_id: int = Depends(tenant_scope)) -> list[dict]:
    rows = await db.fetch(
        """SELECT id, widget, path, duration, transcript, transcript_status, created_at
           FROM flow_recordings WHERE execution_id=$1 AND tenant_id=$2
           ORDER BY created_at""",
        execution_id, tenant_id)
    return [dict(r) for r in rows]
