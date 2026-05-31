import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api";

// Studio-style flow editor. Flows are a JSON graph of widgets; this provides a
// structured editor (list of widgets with type-specific fields), live
// validation, and a scripted test-run that also exercises real webhooks.
interface FlowSummary {
  id: number;
  number: string;
  name: string | null;
  enabled: boolean;
}

const WIDGET_TYPES = ["say", "gather", "record", "http", "branch", "dial", "route", "hangup"];

const STARTER = {
  start: "w1",
  widgets: {
    w1: { type: "say", text: "Hello from your flow.", next: "w2" },
    w2: { type: "hangup" },
  },
};

export default function Flows() {
  const { tid } = useParams();
  const [flows, setFlows] = useState<FlowSummary[]>([]);
  const [editing, setEditing] = useState<any | null>(null);
  const [defText, setDefText] = useState("");
  const [test, setTest] = useState<any>(null);
  const [digits, setDigits] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const base = `/api/tenants/${tid}/flows`;
  async function load() {
    setFlows(await api.get<FlowSummary[]>(base));
  }
  useEffect(() => {
    load();
  }, [tid]);

  async function open(id: number) {
    const f = await api.get<any>(`${base}/${id}`);
    setEditing(f);
    setDefText(JSON.stringify(f.definition, null, 2));
    setTest(null);
    setErr("");
    setMsg("");
  }
  function newFlow() {
    setEditing({ id: null, number: "", name: "", enabled: true, definition: STARTER });
    setDefText(JSON.stringify(STARTER, null, 2));
    setTest(null);
  }

  function parsed(): any | null {
    try {
      return JSON.parse(defText);
    } catch {
      setErr("Definition is not valid JSON");
      return null;
    }
  }

  async function save() {
    setErr("");
    setMsg("");
    const def = parsed();
    if (!def) return;
    const body = {
      number: editing.number,
      name: editing.name,
      enabled: editing.enabled,
      definition: def,
    };
    try {
      if (editing.id) await api.put(`${base}/${editing.id}`, body);
      else await api.post(base, body);
      setMsg("Flow saved.");
      load();
    } catch (e: any) {
      setErr(typeof e.message === "string" ? e.message : JSON.stringify(e.message));
    }
  }
  async function validate() {
    setErr("");
    setMsg("");
    const def = parsed();
    if (!def) return;
    const r = await api.post<any>(`${base}/validate`, { definition: def });
    if (r.valid) setMsg("✓ Valid flow.");
    else setErr("Invalid: " + r.errors.join("; "));
  }
  async function runTest() {
    setErr("");
    const def = parsed();
    if (!def) return;
    try {
      const r = await api.post<any>(`${base}/test`, {
        definition: def,
        digits: digits ? digits.split("").map((d) => d) : [],
      });
      setTest(r);
    } catch (e: any) {
      setErr(typeof e.message === "string" ? e.message : JSON.stringify(e.message));
    }
  }
  async function remove(id: number) {
    if (!confirm("Delete this flow?")) return;
    await api.del(`${base}/${id}`);
    if (editing?.id === id) setEditing(null);
    load();
  }

  return (
    <div>
      <h2>Flows</h2>
      <p className="muted">
        Visual call flows (Twilio Studio-style): say/gather/record, GET/POST
        webhooks, branching, and routing. Set a phone number's destination to
        this flow to use it. Edit the JSON graph, validate, and test-run with
        scripted key presses — webhooks fire for real during a test.
      </p>
      {msg && <div className="callout">{msg}</div>}
      {err && <div className="error">{err}</div>}

      <div className="grid2">
        <div className="card">
          <div className="qhead">
            <h3>{flows.length} flows</h3>
            <button className="btn small" onClick={newFlow}>+ New flow</button>
          </div>
          <table>
            <thead><tr><th>#</th><th>Name</th><th></th></tr></thead>
            <tbody>
              {flows.map((f) => (
                <tr key={f.id}>
                  <td>{f.number}</td>
                  <td>{f.name}{!f.enabled && <span className="muted small"> (off)</span>}</td>
                  <td className="nowrap">
                    <button className="btn small ghost" onClick={() => open(f.id)}>Edit</button>{" "}
                    <button className="btn small danger" onClick={() => remove(f.id)}>Del</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="muted small subhead">Widget types</div>
          <div className="small muted">{WIDGET_TYPES.join(" · ")}</div>
        </div>

        {editing && (
          <div className="card">
            <h3>{editing.id ? `Edit flow ${editing.number}` : "New flow"}</h3>
            <div className="form">
              <div className="row2">
                <label>Number
                  <input value={editing.number}
                    onChange={(e) => setEditing({ ...editing, number: e.target.value })}
                    placeholder="900" /></label>
                <label>Name
                  <input value={editing.name || ""}
                    onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></label>
              </div>
              <label className="row">
                <input type="checkbox" checked={editing.enabled}
                  onChange={(e) => setEditing({ ...editing, enabled: e.target.checked })} /> Enabled
              </label>
              <label>Definition (JSON graph)
                <textarea className="logbox" style={{ minHeight: 260, width: "100%" }}
                  value={defText} onChange={(e) => setDefText(e.target.value)} spellCheck={false} />
              </label>
              <div className="optrow">
                <button className="btn" onClick={save}>Save</button>
                <button className="btn ghost" onClick={validate}>Validate</button>
                <button className="btn ghost" onClick={() => setEditing(null)}>Close</button>
              </div>
              <div className="subhead">Test run</div>
              <label>Key presses to feed gather widgets (e.g. <code>12</code>)
                <input value={digits} onChange={(e) => setDigits(e.target.value)} placeholder="1" />
              </label>
              <button className="btn small" onClick={runTest}>Run test</button>
              {test && (
                <div className="callout">
                  <div className="small"><b>Path:</b> {test.path.join(" → ")}</div>
                  <div className="small"><b>Steps:</b></div>
                  <pre className="logbox" style={{ maxHeight: 160 }}>
{test.trace.map((t: any, i: number) =>
  `${i + 1}. ${t.action}${t.text ? ": " + t.text : ""}${t.digits ? " ⌨ " + t.digits : ""}${t.dest_value ? " → " + t.dest_value : ""}`
).join("\n")}
                  </pre>
                  {test.webhook_log.length > 0 && (
                    <div className="small"><b>Webhooks:</b> {test.webhook_log.map(
                      (w: any) => `${w.method} ${w.status_code}${w.ok ? "✓" : "✗"}`).join(", ")}</div>
                  )}
                  <div className="small"><b>Variables:</b> {JSON.stringify(test.variables)}</div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
