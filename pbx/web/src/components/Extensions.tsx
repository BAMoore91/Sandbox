import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api";

interface Ext {
  extension: string;
  display_name: string;
  email: string | null;
  webrtc: boolean;
  voicemail_enabled: boolean;
  registered: boolean;
}

export default function Extensions() {
  const { tid } = useParams();
  const [list, setList] = useState<Ext[]>([]);
  const [form, setForm] = useState({
    extension: "", display_name: "", email: "", webrtc: true,
    voicemail_enabled: true, vm_pin: "1234",
  });
  const [created, setCreated] = useState<any>(null);
  const [err, setErr] = useState("");

  const base = `/api/tenants/${tid}/extensions`;
  async function load() { setList(await api.get<Ext[]>(base)); }
  useEffect(() => { load(); }, [tid]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setErr(""); setCreated(null);
    try {
      const r = await api.post(base, form);
      setCreated(r);
      setForm({ ...form, extension: "", display_name: "", email: "" });
      load();
    } catch (e: any) { setErr(e.message); }
  }

  async function remove(ext: string) {
    if (!confirm(`Delete extension ${ext}?`)) return;
    await api.del(`${base}/${ext}`);
    load();
  }

  return (
    <div>
      <h2>Extensions</h2>
      <div className="grid2">
        <div className="card">
          <h3>Add extension</h3>
          <form className="form" onSubmit={create}>
            <label>Number<input value={form.extension}
              onChange={(e) => setForm({ ...form, extension: e.target.value })}
              placeholder="1001" required /></label>
            <label>Display name<input value={form.display_name}
              onChange={(e) => setForm({ ...form, display_name: e.target.value })} required /></label>
            <label>Email<input type="email" value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
            <label className="row"><input type="checkbox" checked={form.webrtc}
              onChange={(e) => setForm({ ...form, webrtc: e.target.checked })} /> WebRTC softphone</label>
            <label className="row"><input type="checkbox" checked={form.voicemail_enabled}
              onChange={(e) => setForm({ ...form, voicemail_enabled: e.target.checked })} /> Voicemail</label>
            {err && <div className="error">{err}</div>}
            <button className="btn">Create</button>
          </form>
          {created && (
            <div className="callout">
              <b>Provisioned {created.extension}</b>
              <div className="small">SIP user: <code>{created.sip_username}</code></div>
              <div className="small">SIP pass: <code>{created.sip_password}</code></div>
              <div className="small muted">Use these in the softphone / a SIP device.</div>
            </div>
          )}
        </div>

        <div className="card">
          <h3>{list.length} extensions</h3>
          <table>
            <thead><tr><th>Ext</th><th>Name</th><th>Type</th><th>VM</th><th>Reg</th><th></th></tr></thead>
            <tbody>
              {list.map((e) => (
                <tr key={e.extension}>
                  <td>{e.extension}</td>
                  <td>{e.display_name}</td>
                  <td>{e.webrtc ? "WebRTC" : "SIP"}</td>
                  <td>{e.voicemail_enabled ? "✓" : "—"}</td>
                  <td><span className={"pill " + (e.registered ? "active" : "suspended")}>
                    {e.registered ? "online" : "offline"}</span></td>
                  <td><button className="btn small danger" onClick={() => remove(e.extension)}>Delete</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
