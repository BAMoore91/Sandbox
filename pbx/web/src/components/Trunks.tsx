import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api";

interface Trunk {
  id: number; name: string; provider: string; sip_server: string;
  enabled: boolean; tenant_id: number | null; auth_mode: string;
}

const EMPTY = {
  name: "", provider: "twilio", sip_server: "", sip_port: 5060,
  transport: "transport-udp", auth_mode: "credentials",
  username: "", secret: "", from_domain: "", codecs: "ulaw,alaw",
  media_encryption: "no", register: false, enabled: true,
};

export default function Trunks() {
  const { tid } = useParams();
  const [list, setList] = useState<Trunk[]>([]);
  const [form, setForm] = useState<any>(EMPTY);
  const [err, setErr] = useState("");

  const base = `/api/tenants/${tid}/trunks`;
  async function load() { setList(await api.get<Trunk[]>(base)); }
  useEffect(() => { load(); }, [tid]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    try { await api.post(base, form); setForm(EMPTY); load(); }
    catch (e: any) { setErr(e.message); }
  }
  async function remove(id: number) {
    if (!confirm("Delete trunk?")) return;
    await api.del(`${base}/${id}`); load();
  }

  return (
    <div>
      <h2>SIP Trunks</h2>
      <div className="grid2">
        <div className="card">
          <h3>Add Twilio trunk</h3>
          <p className="muted small">
            From Twilio Console → Elastic SIP Trunking → your trunk → Termination.
            Use the <b>Termination SIP URI</b> host below and a credential-list user.
          </p>
          <form className="form" onSubmit={create}>
            <label>Name<input value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })} required /></label>
            <label>Termination host
              <input value={form.sip_server}
                onChange={(e) => setForm({ ...form, sip_server: e.target.value, from_domain: e.target.value })}
                placeholder="your-trunk.pstn.twilio.com" required /></label>
            <label>Transport
              <select value={form.transport}
                onChange={(e) => setForm({ ...form, transport: e.target.value })}>
                <option value="transport-udp">UDP</option>
                <option value="transport-tls">TLS (secure trunking)</option>
              </select></label>
            <label>Auth mode
              <select value={form.auth_mode}
                onChange={(e) => setForm({ ...form, auth_mode: e.target.value })}>
                <option value="credentials">Credentials</option>
                <option value="ipacl">IP ACL only</option>
              </select></label>
            {form.auth_mode === "credentials" && (
              <>
                <label>Username<input value={form.username}
                  onChange={(e) => setForm({ ...form, username: e.target.value })} /></label>
                <label>Secret<input type="password" value={form.secret}
                  onChange={(e) => setForm({ ...form, secret: e.target.value })} /></label>
              </>
            )}
            <label className="row"><input type="checkbox" checked={form.media_encryption === "sdes"}
              onChange={(e) => setForm({ ...form, media_encryption: e.target.checked ? "sdes" : "no" })} />
              Secure media (SRTP)</label>
            {err && <div className="error">{err}</div>}
            <button className="btn">Create trunk</button>
          </form>
        </div>

        <div className="card">
          <h3>{list.length} trunks</h3>
          <table>
            <thead><tr><th>Name</th><th>Host</th><th>Auth</th><th>Scope</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {list.map((t) => (
                <tr key={t.id}>
                  <td>{t.name}</td>
                  <td className="small">{t.sip_server}</td>
                  <td>{t.auth_mode}</td>
                  <td>{t.tenant_id ? "tenant" : "shared"}</td>
                  <td><span className={"pill " + (t.enabled ? "active" : "suspended")}>
                    {t.enabled ? "enabled" : "disabled"}</span></td>
                  <td>{t.tenant_id && <button className="btn small danger"
                    onClick={() => remove(t.id)}>Delete</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
