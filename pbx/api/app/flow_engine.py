"""Flow engine — executes a Twilio Studio-style JSON flow graph.

The engine is driver-abstracted: it walks the widget graph and decides what to
do, calling an injected `FlowChannel` for media actions (say / gather / record
/ dial / dispatch / hangup). Production uses an ARI-backed channel; tests use a
scripted mock. This keeps all routing/templating/webhook/transcription logic
unit-testable with no live Asterisk.

Widgets (see migration 013 for the schema):
  say     {text, next}
  gather  {text, num_digits, variable, timeout, transitions:{digit:widget}, default}
  record  {max_seconds, transcribe, variable?, next}
  http    {method, url, headers?, body?, save:{var:jsonpath}, success, failure}
  branch  {variable, cases:{value:widget}, default}
  dial    {dest_value, timeout?, answered, noanswer}
  route   {dest_type, dest_value}      (terminal — hands back to dialplan dispatch)
  hangup  {}                           (terminal)

Variables: {{var}} placeholders in text/url/body/headers are substituted from
the execution's variable bag (caller, did, plus anything captured).
"""
from __future__ import annotations

import re
from typing import Any, Protocol

import httpx

MAX_STEPS = 100  # guard against loops in a malformed flow

_VAR_RE = re.compile(r"\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}")


def render_template(text: str, variables: dict) -> str:
    """Substitute {{var}} / {{a.b}} placeholders from `variables`."""
    if not text:
        return text

    def repl(m: re.Match) -> str:
        key = m.group(1)
        cur: Any = variables
        for part in key.split("."):
            if isinstance(cur, dict) and part in cur:
                cur = cur[part]
            else:
                return ""
        return str(cur)

    return _VAR_RE.sub(repl, text)


def _dig(obj: Any, path: str) -> Any:
    """Extract a dotted path from a dict/list JSON structure (best effort)."""
    cur = obj
    for part in path.split("."):
        if part == "":
            continue
        if isinstance(cur, dict):
            cur = cur.get(part)
        elif isinstance(cur, list) and part.isdigit():
            idx = int(part)
            cur = cur[idx] if 0 <= idx < len(cur) else None
        else:
            return None
    return cur


class FlowChannel(Protocol):
    """Media/telephony actions the engine drives. Implemented by ARI in prod."""

    async def say(self, text: str) -> None: ...
    async def gather(self, text: str, num_digits: int, timeout: int) -> str: ...
    async def record(self, max_seconds: int) -> dict: ...
    async def dial(self, dest_value: str, timeout: int) -> str: ...
    async def dispatch(self, dest_type: str, dest_value: str) -> None: ...
    async def hangup(self) -> None: ...


class FlowError(Exception):
    pass


async def _do_http(widget: dict, variables: dict, log: list) -> str:
    """Execute an http widget; capture response into vars; return next widget id."""
    method = (widget.get("method") or "GET").upper()
    url = render_template(widget.get("url", ""), variables)
    headers = {k: render_template(str(v), variables)
               for k, v in (widget.get("headers") or {}).items()}
    body_tmpl = widget.get("body")
    entry = {"widget": widget.get("_id"), "method": method, "url": url,
             "status_code": None, "ok": False, "error": None}
    try:
        async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
            if method == "POST":
                if isinstance(body_tmpl, (dict, list)):
                    # render string leaves of a JSON body
                    payload = _render_json(body_tmpl, variables)
                    resp = await client.post(url, json=payload, headers=headers)
                else:
                    data = render_template(str(body_tmpl or ""), variables)
                    resp = await client.post(url, content=data, headers=headers)
            else:
                resp = await client.get(url, headers=headers)
        entry["status_code"] = resp.status_code
        entry["ok"] = resp.status_code < 400
        # capture pieces of the JSON response into variables
        save = widget.get("save") or {}
        if save:
            try:
                j = resp.json()
            except Exception:
                j = {}
            for var, path in save.items():
                variables[var] = _dig(j, path)
        variables["last_status"] = resp.status_code
    except Exception as exc:
        entry["error"] = str(exc)[:300]
    finally:
        log.append(entry)
    return widget.get("success") if entry["ok"] else (
        widget.get("failure") or widget.get("success"))


def _render_json(obj: Any, variables: dict) -> Any:
    if isinstance(obj, str):
        return render_template(obj, variables)
    if isinstance(obj, dict):
        return {k: _render_json(v, variables) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_render_json(v, variables) for v in obj]
    return obj


def _branch_next(widget: dict, variables: dict) -> str | None:
    var = widget.get("variable", "")
    val = str(variables.get(var, ""))
    cases = widget.get("cases") or {}
    return cases.get(val, widget.get("default"))


class FlowRunner:
    """Walks a validated flow definition over an injected channel.

    `on_record` (optional async cb) is called with each record result so the
    caller can persist + transcribe. `webhook_log` collects http widget calls.
    """

    def __init__(self, definition: dict, channel: FlowChannel,
                 variables: dict | None = None, on_record=None):
        self.widgets = definition.get("widgets", {})
        self.start = definition.get("start")
        self.channel = channel
        self.variables = dict(variables or {})
        self.on_record = on_record
        self.webhook_log: list[dict] = []
        self.path: list[str] = []

    async def run(self) -> dict:
        """Execute from start until a terminal widget. Returns final state."""
        wid = self.start
        steps = 0
        while wid is not None:
            if steps >= MAX_STEPS:
                raise FlowError("flow exceeded max steps (loop?)")
            steps += 1
            widget = self.widgets.get(wid)
            if widget is None:
                raise FlowError(f"unknown widget '{wid}'")
            widget = {**widget, "_id": wid}
            self.path.append(wid)
            wid = await self._exec(widget)
        return {"variables": self.variables, "path": self.path,
                "webhook_log": self.webhook_log}

    async def _exec(self, w: dict) -> str | None:
        t = w.get("type")
        if t == "say":
            await self.channel.say(render_template(w.get("text", ""), self.variables))
            return w.get("next")
        if t == "gather":
            digits = await self.channel.gather(
                render_template(w.get("text", ""), self.variables),
                int(w.get("num_digits", 1)), int(w.get("timeout", 5)))
            if w.get("variable"):
                self.variables[w["variable"]] = digits
            trans = w.get("transitions") or {}
            if digits and digits in trans:
                return trans[digits]
            return w.get("default")
        if t == "record":
            res = await self.channel.record(int(w.get("max_seconds", 60)))
            if w.get("variable"):
                self.variables[w["variable"]] = res.get("path")
            if self.on_record:
                await self.on_record(w, res)
            return w.get("next")
        if t == "http":
            return await _do_http(w, self.variables, self.webhook_log)
        if t == "branch":
            return _branch_next(w, self.variables)
        if t == "dial":
            status = await self.channel.dial(
                render_template(w.get("dest_value", ""), self.variables),
                int(w.get("timeout", 30)))
            return w.get("answered") if status == "ANSWER" else w.get("noanswer")
        if t == "route":
            await self.channel.dispatch(w.get("dest_type", "hangup"),
                                        render_template(w.get("dest_value", ""),
                                                        self.variables))
            return None
        if t == "hangup":
            await self.channel.hangup()
            return None
        raise FlowError(f"unknown widget type '{t}'")


# ---------------------------------------------------------------------------
#  Validation (used by the API on save)
# ---------------------------------------------------------------------------
VALID_TYPES = {"say", "gather", "record", "http", "branch", "dial", "route", "hangup"}
TERMINAL = {"route", "hangup"}


def validate_definition(defn: dict) -> list[str]:
    """Return a list of validation errors ([] == valid)."""
    errs: list[str] = []
    widgets = defn.get("widgets")
    start = defn.get("start")
    if not isinstance(widgets, dict) or not widgets:
        return ["definition must have a non-empty 'widgets' object"]
    if start not in widgets:
        errs.append(f"start '{start}' is not a widget")
    ids = set(widgets)

    def check_ref(ref, ctx):
        if ref is not None and ref not in ids:
            errs.append(f"{ctx} points to unknown widget '{ref}'")

    for wid, w in widgets.items():
        t = w.get("type")
        if t not in VALID_TYPES:
            errs.append(f"widget '{wid}' has invalid type '{t}'")
            continue
        if t == "say":
            check_ref(w.get("next"), f"say '{wid}'.next")
        elif t == "gather":
            for d, ref in (w.get("transitions") or {}).items():
                check_ref(ref, f"gather '{wid}'.transitions['{d}']")
            check_ref(w.get("default"), f"gather '{wid}'.default")
        elif t == "record":
            check_ref(w.get("next"), f"record '{wid}'.next")
        elif t == "http":
            if not w.get("url"):
                errs.append(f"http '{wid}' missing url")
            check_ref(w.get("success"), f"http '{wid}'.success")
            check_ref(w.get("failure"), f"http '{wid}'.failure")
        elif t == "branch":
            for v, ref in (w.get("cases") or {}).items():
                check_ref(ref, f"branch '{wid}'.cases['{v}']")
            check_ref(w.get("default"), f"branch '{wid}'.default")
        elif t == "dial":
            check_ref(w.get("answered"), f"dial '{wid}'.answered")
            check_ref(w.get("noanswer"), f"dial '{wid}'.noanswer")
        elif t == "route":
            if not w.get("dest_value"):
                errs.append(f"route '{wid}' missing dest_value")
    return errs
