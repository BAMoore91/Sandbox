import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api";

interface Tenant {
  id: number;
  name: string;
  slug: string;
  timezone: string;
  recording_enabled: boolean;
  plan_name: string | null;
  plan_code: string | null;
  features: Record<string, boolean> | null;
}

export default function Settings() {
  const { tid } = useParams();
  const [t, setT] = useState<Tenant | null>(null);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  async function load() {
    setT(await api.get<Tenant>(`/api/tenants/${tid}`));
  }
  useEffect(() => {
    load();
  }, [tid]);

  async function patch(body: Record<string, unknown>, note: string) {
    setErr("");
    setMsg("");
    try {
      await api.patch(`/api/tenants/${tid}`, body);
      setMsg(note);
      load();
    } catch (e: any) {
      setErr(e.message);
    }
  }

  if (!t) return <div className="center">Loading…</div>;

  const recAllowed = t.features?.recording !== false;

  return (
    <div>
      <h2>Settings</h2>
      {msg && <div className="callout">{msg}</div>}
      {err && <div className="error">{err}</div>}

      <div className="grid2">
        <div className="card">
          <h3>Company</h3>
          <div className="form">
            <label>
              Name
              <input
                defaultValue={t.name}
                onBlur={(e) => e.target.value !== t.name && patch({ name: e.target.value }, "Name saved")}
              />
            </label>
            <label>
              Timezone
              <input
                defaultValue={t.timezone}
                onBlur={(e) =>
                  e.target.value !== t.timezone && patch({ timezone: e.target.value }, "Timezone saved")
                }
              />
            </label>
            <div className="muted small">
              Plan: <b>{t.plan_name}</b> · slug <code>{t.slug}</code>
            </div>
          </div>
        </div>

        <div className="card">
          <h3>Call Recording</h3>
          <p className="muted small">
            When enabled, answered calls are recorded and appear under
            Recordings. Agents can replay recordings of their own calls.
          </p>
          {!recAllowed && (
            <div className="error">
              Your plan does not include call recording. Upgrade to enable.
            </div>
          )}
          <label className="row">
            <input
              type="checkbox"
              disabled={!recAllowed}
              checked={t.recording_enabled}
              onChange={(e) =>
                patch(
                  { recording_enabled: e.target.checked },
                  e.target.checked ? "Recording enabled" : "Recording disabled"
                )
              }
            />{" "}
            Record calls for this company
          </label>
        </div>

        <RetentionCard tenantId={tid!} />
      </div>
    </div>
  );
}

interface Policy {
  recording_retention_days: number;
  cdr_retention_days: number;
}
interface Run {
  id: number;
  started_at: string;
  recordings_deleted: number;
  cdr_deleted: number;
  files_deleted: number;
  error: string | null;
}

function RetentionCard({ tenantId }: { tenantId: string }) {
  const [p, setP] = useState<Policy | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const base = `/api/tenants/${tenantId}/retention`;
  async function load() {
    setP(await api.get<Policy>(base));
    setRuns(await api.get<Run[]>(`${base}/runs?limit=5`));
  }
  useEffect(() => {
    load();
  }, [tenantId]);

  async function save() {
    if (!p) return;
    setErr("");
    setMsg("");
    try {
      await api.put(base, p);
      setMsg("Retention policy saved.");
    } catch (e: any) {
      setErr(e.message);
    }
  }
  async function runNow() {
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      const r = await api.post<any>(`${base}/run`);
      setMsg(`Purge complete: ${r.recordings_deleted} recordings, ${r.cdr_deleted} call logs removed.`);
      load();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (!p) return null;

  return (
    <div className="card">
      <h3>Data Retention</h3>
      <p className="muted small">
        Automatically delete old data. <b>0 = keep forever.</b> A sweep runs
        daily; you can also run it now.
      </p>
      {msg && <div className="callout">{msg}</div>}
      {err && <div className="error">{err}</div>}
      <div className="form">
        <label>
          Delete recordings older than (days)
          <input
            type="number"
            min={0}
            value={p.recording_retention_days}
            onChange={(e) =>
              setP({ ...p, recording_retention_days: +e.target.value })
            }
          />
        </label>
        <label>
          Delete call logs (CDR) older than (days)
          <input
            type="number"
            min={0}
            value={p.cdr_retention_days}
            onChange={(e) => setP({ ...p, cdr_retention_days: +e.target.value })}
          />
        </label>
        <div className="optrow">
          <button className="btn" onClick={save}>
            Save policy
          </button>
          <button className="btn ghost" onClick={runNow} disabled={busy}>
            {busy ? "Purging…" : "Run purge now"}
          </button>
        </div>
      </div>

      {runs.length > 0 && (
        <>
          <div className="subhead">Recent sweeps</div>
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Recordings</th>
                <th>Call logs</th>
                <th>Files</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <td className="small">{new Date(r.started_at).toLocaleString()}</td>
                  <td>{r.recordings_deleted}</td>
                  <td>{r.cdr_deleted}</td>
                  <td>{r.files_deleted}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
