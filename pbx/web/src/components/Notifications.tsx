import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api";

// Admin: per-extension missed-call / voicemail notification preferences,
// plus a view of the recent delivery outbox.
interface Pref {
  extension: string;
  display_name: string | null;
  email: string | null;
  notify_email: string | null;
  notify_sms: string | null;
  notify_on_missed: boolean;
  notify_on_voicemail: boolean;
  notify_channel_email: boolean;
  notify_channel_sms: boolean;
}
interface Note {
  id: number;
  extension: string;
  event: string;
  channel: string;
  recipient: string;
  status: string;
  attempts: number;
  last_error: string | null;
  created_at: string;
}

export default function Notifications() {
  const { tid } = useParams();
  const [prefs, setPrefs] = useState<Pref[]>([]);
  const [outbox, setOutbox] = useState<Note[]>([]);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const base = `/api/tenants/${tid}/notifications`;
  async function load() {
    setPrefs(await api.get<Pref[]>(`${base}/prefs`));
    setOutbox(await api.get<Note[]>(`${base}?limit=50`));
  }
  useEffect(() => {
    load();
  }, [tid]);

  function setLocal(ext: string, patch: Partial<Pref>) {
    setPrefs((ps) => ps.map((p) => (p.extension === ext ? { ...p, ...patch } : p)));
  }
  async function save(p: Pref) {
    setErr("");
    setMsg("");
    try {
      await api.put(`${base}/prefs/${p.extension}`, {
        notify_email: p.notify_email,
        notify_sms: p.notify_sms,
        notify_on_missed: p.notify_on_missed,
        notify_on_voicemail: p.notify_on_voicemail,
        notify_channel_email: p.notify_channel_email,
        notify_channel_sms: p.notify_channel_sms,
      });
      setMsg(`Saved notification settings for ${p.extension}.`);
    } catch (e: any) {
      setErr(e.message);
    }
  }
  async function test(p: Pref) {
    setErr("");
    setMsg("");
    try {
      const r = await api.post<any>(`${base}/test`, {
        extension: p.extension,
        event: "missed",
      });
      setMsg(`Test queued (${r.queued}) and delivery attempted for ${p.extension}.`);
      load();
    } catch (e: any) {
      setErr(e.message);
    }
  }

  return (
    <div>
      <h2>Notifications</h2>
      <p className="muted">
        Email/SMS alerts for missed calls and new voicemail, per extension. SMS
        requires Twilio credentials configured on the server; email requires
        SMTP.
      </p>
      {msg && <div className="callout">{msg}</div>}
      {err && <div className="error">{err}</div>}

      <div className="card">
        <h3>Per-extension preferences</h3>
        <table>
          <thead>
            <tr>
              <th>Ext</th>
              <th>Events</th>
              <th>Email</th>
              <th>SMS</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {prefs.map((p) => (
              <tr key={p.extension}>
                <td>
                  {p.extension}
                  <div className="small muted">{p.display_name}</div>
                </td>
                <td>
                  <label className="row small">
                    <input
                      type="checkbox"
                      checked={p.notify_on_missed}
                      onChange={(e) => setLocal(p.extension, { notify_on_missed: e.target.checked })}
                    />{" "}
                    Missed
                  </label>
                  <label className="row small">
                    <input
                      type="checkbox"
                      checked={p.notify_on_voicemail}
                      onChange={(e) =>
                        setLocal(p.extension, { notify_on_voicemail: e.target.checked })
                      }
                    />{" "}
                    Voicemail
                  </label>
                </td>
                <td>
                  <label className="row small">
                    <input
                      type="checkbox"
                      checked={p.notify_channel_email}
                      onChange={(e) =>
                        setLocal(p.extension, { notify_channel_email: e.target.checked })
                      }
                    />{" "}
                    on
                  </label>
                  <input
                    style={{ width: 160 }}
                    placeholder={p.email || "address"}
                    value={p.notify_email || ""}
                    onChange={(e) => setLocal(p.extension, { notify_email: e.target.value })}
                  />
                </td>
                <td>
                  <label className="row small">
                    <input
                      type="checkbox"
                      checked={p.notify_channel_sms}
                      onChange={(e) =>
                        setLocal(p.extension, { notify_channel_sms: e.target.checked })
                      }
                    />{" "}
                    on
                  </label>
                  <input
                    style={{ width: 140 }}
                    placeholder="+1…"
                    value={p.notify_sms || ""}
                    onChange={(e) => setLocal(p.extension, { notify_sms: e.target.value })}
                  />
                </td>
                <td className="nowrap">
                  <button className="btn small" onClick={() => save(p)}>
                    Save
                  </button>{" "}
                  <button className="btn small ghost" onClick={() => test(p)}>
                    Test
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3>Recent deliveries</h3>
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Ext</th>
              <th>Event</th>
              <th>Channel</th>
              <th>To</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {outbox.map((n) => (
              <tr key={n.id}>
                <td className="small">{new Date(n.created_at).toLocaleString()}</td>
                <td>{n.extension}</td>
                <td>{n.event}</td>
                <td>{n.channel}</td>
                <td className="small">{n.recipient}</td>
                <td>
                  <span
                    className={
                      "pill " +
                      (n.status === "sent"
                        ? "active"
                        : n.status === "failed"
                        ? "suspended"
                        : "")
                    }
                    title={n.last_error || ""}
                  >
                    {n.status}
                    {n.attempts > 1 ? ` (${n.attempts})` : ""}
                  </span>
                </td>
              </tr>
            ))}
            {outbox.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  No notifications yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
