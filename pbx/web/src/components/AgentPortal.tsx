import { useEffect, useState } from "react";
import { api, getToken } from "../api";

// Self-service surface for an `agent` role: manage only their own extension.
interface MyExt {
  extension: string;
  display_name: string;
  endpoint_id: string;
  dnd: boolean;
  call_forward: string | null;
  ring_seconds: number;
  voicemail_enabled: boolean;
  webrtc: boolean;
  tenant_slug: string;
}
interface Me {
  email: string;
  full_name: string | null;
  role: string;
  extension: MyExt | null;
}
interface Call {
  calldate: string;
  src: string;
  dst: string;
  direction: string;
  billsec: number;
  disposition: string;
  recording_id: number | null;
}

export default function AgentPortal() {
  const [me, setMe] = useState<Me | null>(null);
  const [online, setOnline] = useState(false);
  const [calls, setCalls] = useState<Call[]>([]);
  const [cf, setCf] = useState("");
  const [dialTo, setDialTo] = useState("");
  const [newCreds, setNewCreds] = useState<{ u: string; p: string } | null>(null);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  async function load() {
    const m = await api.get<Me>("/api/me");
    setMe(m);
    setCf(m.extension?.call_forward || "");
    if (m.extension) {
      try {
        const s = await api.get<{ online: boolean }>("/api/me/status");
        setOnline(s.online);
      } catch {
        /* ignore */
      }
      try {
        setCalls(await api.get<Call[]>("/api/me/calls?limit=25"));
      } catch {
        /* ignore */
      }
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function patch(body: Record<string, unknown>, note: string) {
    setErr("");
    setMsg("");
    try {
      await api.patch("/api/me", body);
      setMsg(note);
      load();
    } catch (e: any) {
      setErr(e.message);
    }
  }

  async function regen() {
    setErr("");
    try {
      const r = await api.post<{ sip_username: string; sip_password: string }>(
        "/api/me/regenerate-sip-password"
      );
      setNewCreds({ u: r.sip_username, p: r.sip_password });
    } catch (e: any) {
      setErr(e.message);
    }
  }

  async function call() {
    setErr("");
    setMsg("");
    try {
      await api.post("/api/me/call", { to_number: dialTo });
      setMsg(`Calling ${dialTo} — your phone will ring first.`);
    } catch (e: any) {
      setErr(e.message);
    }
  }

  async function playRecording(id: number, el: HTMLAudioElement) {
    const res = await fetch(`/api/me/recordings/${id}/audio`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    if (!res.ok) {
      setErr(res.status === 404 ? "Recording not available." : "Cannot play recording.");
      return;
    }
    el.src = URL.createObjectURL(await res.blob());
    el.play();
  }

  if (!me) return <div className="center">Loading…</div>;

  if (!me.extension) {
    return (
      <div>
        <h2>My Phone</h2>
        <div className="card">
          <p>
            Signed in as <b>{me.email}</b>.
          </p>
          <p className="muted">
            No extension is linked to your account yet. Ask your administrator
            to link you to an extension.
          </p>
        </div>
      </div>
    );
  }

  const e = me.extension;

  return (
    <div>
      <h2>
        My Phone <span className="muted small">· ext {e.extension}</span>
      </h2>

      {msg && <div className="callout">{msg}</div>}
      {err && <div className="error">{err}</div>}

      <div className="grid2">
        <div className="card">
          <h3>
            Status{" "}
            <span className={"pill " + (online ? "active" : "suspended")}>
              {online ? "online" : "offline"}
            </span>
          </h3>
          <div className="form">
            <label className="row">
              <input
                type="checkbox"
                checked={e.dnd}
                onChange={(ev) =>
                  patch({ dnd: ev.target.checked }, "Do-not-disturb updated")
                }
              />{" "}
              Do Not Disturb
            </label>

            <label>
              Forward my calls to (extension or number; blank = off)
              <div className="optrow">
                <input value={cf} onChange={(ev) => setCf(ev.target.value)} placeholder="1002" />
                <button
                  className="btn small"
                  onClick={() => patch({ call_forward: cf }, "Call forwarding updated")}
                >
                  Save
                </button>
              </div>
            </label>

            <label>
              Ring time before voicemail (s)
              <input
                type="number"
                defaultValue={e.ring_seconds}
                onBlur={(ev) =>
                  patch({ ring_seconds: +ev.target.value }, "Ring time updated")
                }
              />
            </label>
          </div>
        </div>

        <div className="card">
          <h3>Dialer (click-to-call)</h3>
          <p className="muted small">
            Rings your registered phone first, then connects the call.
          </p>
          <div className="optrow">
            <input
              value={dialTo}
              onChange={(ev) => setDialTo(ev.target.value)}
              placeholder="1002 or +13105551234"
            />
            <button className="btn" onClick={call} disabled={!dialTo}>
              Call
            </button>
          </div>

          <div className="subhead">Softphone credentials</div>
          <p className="muted small">
            SIP user <code>{e.endpoint_id}</code>. Generate a new password to set
            up a desk phone or the WebRTC softphone.
          </p>
          <button className="btn ghost small" onClick={regen}>
            Regenerate SIP password
          </button>
          {newCreds && (
            <div className="callout">
              <div className="small">
                user: <code>{newCreds.u}</code>
              </div>
              <div className="small">
                pass: <code>{newCreds.p}</code>
              </div>
              <div className="small muted">Copy now — it isn't shown again.</div>
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <h3>My recent calls</h3>
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Dir</th>
              <th>From</th>
              <th>To</th>
              <th>Sec</th>
              <th>Result</th>
              <th>Recording</th>
            </tr>
          </thead>
          <tbody>
            {calls.map((c, i) => (
              <tr key={i}>
                <td className="small">{new Date(c.calldate).toLocaleString()}</td>
                <td>
                  <span className="pill">{c.direction}</span>
                </td>
                <td>{c.src}</td>
                <td>{c.dst}</td>
                <td>{c.billsec}</td>
                <td className="small">{c.disposition}</td>
                <td>
                  {c.recording_id ? (
                    <>
                      <audio id={`mrec-${c.recording_id}`} />
                      <button
                        className="btn small ghost"
                        onClick={() =>
                          playRecording(
                            c.recording_id!,
                            document.getElementById(
                              `mrec-${c.recording_id}`
                            ) as HTMLAudioElement
                          )
                        }
                      >
                        ▶
                      </button>
                    </>
                  ) : (
                    <span className="muted small">—</span>
                  )}
                </td>
              </tr>
            ))}
            {calls.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">
                  No calls yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
