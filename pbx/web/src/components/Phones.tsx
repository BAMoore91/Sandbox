import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api";

// Admin: auto-provisioning for physical desk phones (register by MAC, assign
// an extension, copy the provisioning URL) + per-extension BLF/key editor.
interface Device {
  id: number;
  mac: string;
  vendor: string;
  model: string | null;
  extension: string | null;
  label: string | null;
  provision_token: string | null;
  last_seen_at: string | null;
  last_ip: string | null;
}
interface Ext {
  extension: string;
  display_name: string;
}
interface Key {
  key_index: number;
  key_type: string;
  label: string | null;
  value: string;
}

const NEWDEV = { mac: "", vendor: "yealink", model: "", extension: "", label: "", provision_token: "" };

export default function Phones() {
  const { tid } = useParams();
  const [devices, setDevices] = useState<Device[]>([]);
  const [exts, setExts] = useState<Ext[]>([]);
  const [form, setForm] = useState<any>(NEWDEV);
  const [keysFor, setKeysFor] = useState<string>("");
  const [keys, setKeys] = useState<Key[]>([]);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const base = `/api/tenants/${tid}`;
  async function load() {
    setDevices(await api.get<Device[]>(`${base}/devices`));
    setExts(await api.get<Ext[]>(`${base}/extensions`));
  }
  useEffect(() => {
    load();
  }, [tid]);

  async function addDevice(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setMsg("");
    try {
      const r = await api.post<any>(`${base}/devices`, {
        ...form,
        extension: form.extension || null,
        provision_token: form.provision_token || null,
      });
      setMsg(`Registered ${r.mac}. Provisioning URL: ${r.provisioning_url}`);
      setForm(NEWDEV);
      load();
    } catch (e: any) {
      setErr(e.message);
    }
  }
  async function removeDevice(id: number) {
    if (!confirm("Remove this phone?")) return;
    await api.del(`${base}/devices/${id}`);
    load();
  }

  async function openKeys(ext: string) {
    setKeysFor(ext);
    setKeys(await api.get<Key[]>(`${base}/extensions/${ext}/keys`));
  }
  function addKeyRow() {
    setKeys((ks) => [
      ...ks,
      {
        key_index: (ks.length ? ks[ks.length - 1].key_index : 0) + 1,
        key_type: "blf",
        label: "",
        value: "",
      },
    ]);
  }
  function updateKey(i: number, patch: Partial<Key>) {
    setKeys((ks) => ks.map((k, j) => (j === i ? { ...k, ...patch } : k)));
  }
  async function saveKeys() {
    setErr("");
    setMsg("");
    try {
      await api.put(`${base}/extensions/${keysFor}/keys`, keys);
      setMsg(`Saved ${keys.length} keys for ${keysFor}. Re-provision the phone to apply.`);
    } catch (e: any) {
      setErr(e.message);
    }
  }

  return (
    <div>
      <h2>Phones (Auto-Provisioning)</h2>
      <p className="muted">
        Register a desk phone by MAC and assign an extension; point the phone's
        provisioning server URL at this PBX. BLF/speed-dial keys are set per
        extension and written into the phone's config.
      </p>
      {msg && <div className="callout">{msg}</div>}
      {err && <div className="error">{err}</div>}

      <div className="grid2">
        <div className="card">
          <h3>Register a phone</h3>
          <form className="form" onSubmit={addDevice}>
            <label>MAC address
              <input value={form.mac} onChange={(e) => setForm({ ...form, mac: e.target.value })}
                placeholder="80:5e:0c:aa:bb:cc" required />
            </label>
            <label>Vendor
              <select value={form.vendor} onChange={(e) => setForm({ ...form, vendor: e.target.value })}>
                <option value="yealink">Yealink</option>
                <option value="grandstream">Grandstream</option>
              </select>
            </label>
            <label>Model<input value={form.model}
              onChange={(e) => setForm({ ...form, model: e.target.value })} placeholder="T46U" /></label>
            <label>Extension
              <select value={form.extension} onChange={(e) => setForm({ ...form, extension: e.target.value })}>
                <option value="">— none —</option>
                {exts.map((x) => <option key={x.extension} value={x.extension}>{x.extension} · {x.display_name}</option>)}
              </select>
            </label>
            <label>Provisioning token (optional)
              <input value={form.provision_token}
                onChange={(e) => setForm({ ...form, provision_token: e.target.value })}
                placeholder="shared secret in URL" />
            </label>
            <button className="btn">Register</button>
          </form>
        </div>

        <div className="card">
          <h3>{devices.length} phones</h3>
          <table>
            <thead><tr><th>MAC</th><th>Vendor</th><th>Ext</th><th>Last seen</th><th></th></tr></thead>
            <tbody>
              {devices.map((d) => (
                <tr key={d.id}>
                  <td className="small"><code>{d.mac}</code><div className="muted small">{d.label}</div></td>
                  <td>{d.vendor}</td>
                  <td>{d.extension || "—"}</td>
                  <td className="small">{d.last_seen_at ? new Date(d.last_seen_at).toLocaleString() : "never"}</td>
                  <td className="nowrap">
                    {d.extension && (
                      <button className="btn small ghost" onClick={() => openKeys(d.extension!)}>Keys</button>
                    )}{" "}
                    <button className="btn small danger" onClick={() => removeDevice(d.id)}>Remove</button>
                  </td>
                </tr>
              ))}
              {devices.length === 0 && <tr><td colSpan={5} className="muted">No phones yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {keysFor && (
        <div className="card">
          <h3>BLF / programmable keys — extension {keysFor}</h3>
          <table>
            <thead><tr><th>#</th><th>Type</th><th>Label</th><th>Value</th><th></th></tr></thead>
            <tbody>
              {keys.map((k, i) => (
                <tr key={i}>
                  <td><input style={{ width: 50 }} type="number" value={k.key_index}
                    onChange={(e) => updateKey(i, { key_index: +e.target.value })} /></td>
                  <td>
                    <select value={k.key_type} onChange={(e) => updateKey(i, { key_type: e.target.value })}>
                      <option value="blf">BLF (presence)</option>
                      <option value="speeddial">Speed dial</option>
                      <option value="line">Line</option>
                    </select>
                  </td>
                  <td><input value={k.label || ""} onChange={(e) => updateKey(i, { label: e.target.value })} /></td>
                  <td><input value={k.value} onChange={(e) => updateKey(i, { value: e.target.value })}
                    placeholder="ext to monitor / number" /></td>
                  <td><button className="btn small danger"
                    onClick={() => setKeys((ks) => ks.filter((_, j) => j !== i))}>×</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="optrow">
            <button className="btn small ghost" onClick={addKeyRow}>+ Add key</button>
            <button className="btn small" onClick={saveKeys}>Save keys</button>
            <button className="btn small ghost" onClick={() => setKeysFor("")}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}
