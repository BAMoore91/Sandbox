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

  // ---- Twilio account integration (auto-provision + import numbers) ----
  const twBase = `/api/tenants/${tid}/twilio`;
  const [tw, setTw] = useState<any>(null);
  const [creds, setCreds] = useState({ account_sid: "", auth_token: "", api_key_sid: "", api_key_secret: "" });
  const [twMsg, setTwMsg] = useState("");
  const [twErr, setTwErr] = useState("");
  const [twBusy, setTwBusy] = useState(false);

  async function loadTw() {
    try { setTw(await api.get<any>(`${twBase}/account`)); } catch { /* ignore */ }
  }
  useEffect(() => { loadTw(); }, [tid]);

  async function saveCreds(e: React.FormEvent) {
    e.preventDefault(); setTwErr(""); setTwMsg(""); setTwBusy(true);
    try {
      const r = await api.put<any>(`${twBase}/account`, {
        account_sid: creds.account_sid,
        auth_token: creds.auth_token || undefined,
        api_key_sid: creds.api_key_sid || undefined,
        api_key_secret: creds.api_key_secret || undefined,
      });
      setTwMsg(`Verified Twilio account ${r.account?.friendly_name || ""}.`);
      setCreds({ account_sid: "", auth_token: "", api_key_sid: "", api_key_secret: "" });
      loadTw();
    } catch (e: any) { setTwErr(typeof e.message === "string" ? e.message : JSON.stringify(e.message)); }
    finally { setTwBusy(false); }
  }
  async function provisionTrunk() {
    setTwErr(""); setTwMsg(""); setTwBusy(true);
    try {
      const r = await api.post<any>(`${twBase}/provision-trunk`, { name: "Twilio Trunk" });
      setTwMsg(`Trunk created on Twilio (${r.twilio_trunk_sid}); origination → ${r.origination_url}.`);
      loadTw(); load();
    } catch (e: any) { setTwErr(typeof e.message === "string" ? e.message : JSON.stringify(e.message)); }
    finally { setTwBusy(false); }
  }
  async function importNumbers() {
    setTwErr(""); setTwMsg(""); setTwBusy(true);
    try {
      const r = await api.post<any>(`${twBase}/import-numbers`, { dest_type: "ivr", dest_value: "500", attach_to_trunk: true });
      setTwMsg(`Imported ${r.imported} number(s); ${r.skipped_existing} already existed; ${r.attached_to_trunk} attached to trunk.`);
    } catch (e: any) { setTwErr(typeof e.message === "string" ? e.message : JSON.stringify(e.message)); }
    finally { setTwBusy(false); }
  }

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

      <div className="card">
        <h3>⚡ Auto-provision from Twilio account</h3>
        <p className="muted small">
          Connect your Twilio account with its <b>Account SID</b> + auth token
          (or an API key/secret). We'll create the Elastic SIP Trunk for you —
          trunk, termination credentials, and an origination URL pointing back
          at this PBX — and import your phone numbers as inbound DIDs.
        </p>
        {twMsg && <div className="callout">{twMsg}</div>}
        {twErr && <div className="error">{twErr}</div>}
        {tw?.account_sid ? (
          <div className="form">
            <div className="small">
              Connected account <code>{tw.account_sid}</code>
              {tw.trunk_sid && <> · trunk <code>{tw.trunk_sid}</code></>}
              {tw.domain_prefix && <> · <code>{tw.domain_prefix}.pstn.twilio.com</code></>}
            </div>
            <div className="optrow">
              {!tw.trunk_sid && (
                <button className="btn" disabled={twBusy} onClick={provisionTrunk}>
                  {twBusy ? "Provisioning…" : "Auto-provision SIP trunk"}
                </button>
              )}
              <button className="btn ghost" disabled={twBusy} onClick={importNumbers}>
                {twBusy ? "Working…" : "Import phone numbers"}
              </button>
            </div>
          </div>
        ) : (
          <form className="form" onSubmit={saveCreds}>
            <label>Account SID
              <input value={creds.account_sid} placeholder="AC…"
                onChange={(e) => setCreds({ ...creds, account_sid: e.target.value })} required /></label>
            <label>Auth token (or use an API key below)
              <input type="password" value={creds.auth_token}
                onChange={(e) => setCreds({ ...creds, auth_token: e.target.value })} /></label>
            <div className="row2">
              <label>API key SID (optional)
                <input value={creds.api_key_sid} placeholder="SK…"
                  onChange={(e) => setCreds({ ...creds, api_key_sid: e.target.value })} /></label>
              <label>API key secret
                <input type="password" value={creds.api_key_secret}
                  onChange={(e) => setCreds({ ...creds, api_key_secret: e.target.value })} /></label>
            </div>
            <button className="btn" disabled={twBusy}>
              {twBusy ? "Verifying…" : "Connect Twilio account"}
            </button>
          </form>
        )}
      </div>

      <div className="grid2">
        <div className="card">
          <h3>Add Twilio trunk (manual)</h3>
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
