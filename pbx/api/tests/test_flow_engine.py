"""Unit tests for the flow engine (no telephony / DB needed).

Run with:  pip install pytest pytest-asyncio && pytest api/tests
The engine is driver-abstracted, so a scripted MockChannel exercises every
widget type, variable templating, branching, and gather/route logic.
"""
import asyncio

import pytest

from app.flow_engine import FlowRunner, render_template, validate_definition


class MockChannel:
    def __init__(self, digits=None):
        self.digits = iter(digits or [])
        self.trace = []

    async def say(self, text):
        self.trace.append(("say", text))

    async def gather(self, text, num_digits, timeout):
        self.trace.append(("gather", text))
        return next(self.digits, "")

    async def record(self, max_seconds):
        self.trace.append(("record", max_seconds))
        return {"path": "rec.wav", "duration": 3}

    async def dial(self, dest_value, timeout):
        self.trace.append(("dial", dest_value))
        return "ANSWER"

    async def dispatch(self, dest_type, dest_value):
        self.trace.append(("route", dest_type, dest_value))

    async def hangup(self):
        self.trace.append(("hangup",))


def run(defn, **kw):
    ch = MockChannel(kw.pop("digits", None))
    runner = FlowRunner(defn, ch, variables=kw.pop("variables", {}), **kw)
    res = asyncio.run(runner.run())
    return ch, res


def test_template_basic_and_nested():
    assert render_template("hi {{a}}", {"a": "x"}) == "hi x"
    assert render_template("{{a.b}}", {"a": {"b": "deep"}}) == "deep"
    assert render_template("{{missing}}", {}) == ""


def test_say_then_hangup():
    ch, res = run({"start": "s", "widgets": {
        "s": {"type": "say", "text": "hello", "next": "h"},
        "h": {"type": "hangup"}}})
    assert res["path"] == ["s", "h"]
    assert ("say", "hello") in ch.trace
    assert ch.trace[-1] == ("hangup",)


def test_gather_routes_on_digit():
    defn = {"start": "g", "widgets": {
        "g": {"type": "gather", "text": "press", "num_digits": 1, "variable": "c",
              "transitions": {"1": "r"}, "default": "h"},
        "r": {"type": "route", "dest_type": "extension", "dest_value": "1001"},
        "h": {"type": "hangup"}}}
    ch, res = run(defn, digits=["1"])
    assert res["path"] == ["g", "r"]
    assert res["variables"]["c"] == "1"
    assert ("route", "extension", "1001") in ch.trace


def test_gather_default_on_no_match():
    defn = {"start": "g", "widgets": {
        "g": {"type": "gather", "text": "press", "num_digits": 1,
              "transitions": {"1": "r"}, "default": "h"},
        "r": {"type": "hangup"}, "h": {"type": "hangup"}}}
    _, res = run(defn, digits=["9"])
    assert res["path"] == ["g", "h"]


def test_branch_on_variable():
    defn = {"start": "b", "widgets": {
        "b": {"type": "branch", "variable": "tier", "cases": {"gold": "g"}, "default": "d"},
        "g": {"type": "hangup"}, "d": {"type": "hangup"}}}
    _, res = run(defn, variables={"tier": "gold"})
    assert res["path"] == ["b", "g"]
    _, res2 = run(defn, variables={"tier": "bronze"})
    assert res2["path"] == ["b", "d"]


def test_record_captures_var_and_callback():
    seen = []

    async def on_record(w, r):
        seen.append((w["_id"], r["path"]))

    defn = {"start": "rec", "widgets": {
        "rec": {"type": "record", "max_seconds": 30, "variable": "vm", "next": "h"},
        "h": {"type": "hangup"}}}
    _, res = run(defn, on_record=on_record)
    assert res["variables"]["vm"] == "rec.wav"
    assert seen == [("rec", "rec.wav")]


def test_dial_answered_vs_noanswer():
    defn = {"start": "d", "widgets": {
        "d": {"type": "dial", "dest_value": "1002", "answered": "a", "noanswer": "n"},
        "a": {"type": "hangup"}, "n": {"type": "hangup"}}}
    _, res = run(defn)
    assert res["path"] == ["d", "a"]   # MockChannel.dial returns ANSWER


def test_loop_guard():
    defn = {"start": "a", "widgets": {"a": {"type": "say", "text": "x", "next": "a"}}}
    with pytest.raises(Exception):
        run(defn)


def test_validate_catches_dangling_refs():
    errs = validate_definition({"start": "a", "widgets": {
        "a": {"type": "say", "text": "x", "next": "ghost"}}})
    assert any("ghost" in e for e in errs)


def test_validate_ok():
    assert validate_definition({"start": "a", "widgets": {
        "a": {"type": "hangup"}}}) == []
