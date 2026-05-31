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
      </div>
    </div>
  );
}
