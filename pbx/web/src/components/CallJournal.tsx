import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api";

// Call journaling: forward every CDR to an external PostgreSQL or HTTP webhook.
interface Sink {
  id: number; name: string; type: string; target_table: string;
  url: string | null; dsn: string | null; auth_header: string | null;
  batch_size: number; enabled: boolean; cursor_id: number;
  delivered_total: number; last_status: string | null; last_error: string | null;
  last_run_at: string | null; platform_wide: boolean; read_only: boolean;
}

const BLANK = {
  name: "", type: "postgres", dsn: "", target_table: "pbx_cdr",
  url: "", auth_header: "", batch_size: 200, enabled: true, platform_wide: false,
};

export default function CallJournal() {
  const { tid } = useParams();
  const [sinks, setSinks] = useState<Sink[]>([]);
  const [form, setForm] = useState<any>(BLANK);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const base = `/api/tenants/${tid}/call-journal`;

  async function load() { setSinks(await api.get<Sink[]>(base)); }
  useEffect(() => { load(); const i = setInterval(load, 10000); return () => clearInterval(i); }, [tid]);

  async function create(e: React.FormEvent) {
    e.preventDefault(); setErr(""); setMsg("");
    try { await api.post(base, form); setForm(BLANK); load(); }
    catch (e: any) { setErr(typeof e.message === "string" ? e.message : JSON.stringify(e.message)); }
  }
  async function act(id: number, path: string, label: string) {
    setErr(""); setMsg("");
    try { const r = await api.post<any>(`${base}/${id}/${path}`); setMsg(`${label}: ${JSON.stringify(r)}`); load(); }
    catch (e: any) { setErr(typeof e.message === "string" ? e.message : JSON.stringify(e.message)); }
  }
  async function remove(id: number) {
    if (!confirm("Delete this journaling sink?")) return;
    await api.del(`${base}/${id}`); load();
  }

  return (
    <div>
      <h2>Call Journaling</h2>
      <p className="muted">
        Continuously forward every call record (CDR) to an <b>external
        PostgreSQL database</b> or an <b>HTTP webhook</b>. Delivery is
        append-only with a durable cursor — no calls are lost or duplicated, and
        a failed destination simply retries from where it left off.
      </p>
      {msg && <div className="callout">{msg}</div>}
      {err && <div className="error">{err}</div>}

      <div className="grid2">
        <div className="card">
          <h3>Add a sink</h3>
          <form className="form" onSubmit={create}>
            <div className="row2">
              <label>Name<input value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })} required /></label>
              <label>Type
                <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                  <option value="postgres">External PostgreSQL</option>
                  <option value="webhook">HTTP webhook</option>
                </select></label>
            </div>
            {form.type === "postgres" ? (
              <>
                <label>Connection string (DSN)
                  <input value={form.dsn} placeholder="postgresql://user:pass@host:5432/db"
                    onChange={(e) => setForm({ ...form, dsn: e.target.value })} /></label>
                <label>Target table
                  <input value={form.target_table}
                    onChange={(e) => setForm({ ...form, target_table: e.target.value })} /></label>
              </>
            ) : (
              <>
                <label>Webhook URL
                  <input value={form.url} placeholder="https://example.com/cdr"
                    onChange={(e) => setForm({ ...form, url: e.target.value })} /></label>
                <label>Authorization header (optional)
                  <input value={form.auth_header} placeholder="Bearer …"
                    onChange={(e) => setForm({ ...form, auth_header: e.target.value })} /></label>
              </>
            )}
            <div className="row2">
              <label>Batch size<input type="number" value={form.batch_size}
                onChange={(e) => setForm({ ...form, batch_size: +e.target.value })} /></label>
              <label className="row"><input type="checkbox" checked={form.enabled}
                onChange={(e) => setForm({ ...form, enabled: e.target.checked })} /> Enabled</label>
            </div>
            <button className="btn">Add sink</button>
          </form>
        </div>

        <div className="card">
          <h3>{sinks.length} sinks</h3>
          <table>
            <thead><tr><th>Name</th><th>Type</th><th>Delivered</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {sinks.map((s) => (
                <tr key={s.id}>
                  <td>{s.name}{s.platform_wide && <span className="pill"> platform</span>}
                    <div className="small muted">{s.type === "postgres" ? s.target_table : s.url}</div></td>
                  <td>{s.type}</td>
                  <td>{s.delivered_total}<div className="small muted">@id {s.cursor_id}</div></td>
                  <td><span className={"pill " + (s.last_status === "ok" ? "active" : s.last_status === "error" ? "suspended" : "")}
                    title={s.last_error || ""}>{s.last_status || "idle"}</span></td>
                  <td className="nowrap">
                    {!s.read_only && <>
                      <button className="btn small ghost" onClick={() => act(s.id, "test", "Test")}>Test</button>{" "}
                      <button className="btn small" onClick={() => act(s.id, "run", "Run")}>Run now</button>{" "}
                      <button className="btn small danger" onClick={() => remove(s.id)}>✕</button>
                    </>}
                    {s.read_only && <span className="muted small">platform-managed</span>}
                  </td>
                </tr>
              ))}
              {sinks.length === 0 && <tr><td colSpan={5} className="muted">No sinks configured.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
