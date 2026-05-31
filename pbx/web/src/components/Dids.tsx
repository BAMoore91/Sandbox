import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api";

interface Did {
  id: number; number: string; description: string | null;
  dest_type: string; dest_value: string; enabled: boolean;
}

const DEST_TYPES = ["extension", "ringgroup", "queue", "ivr", "flow", "voicemail", "timecondition", "hangup"];

export default function Dids() {
  const { tid } = useParams();
  const [list, setList] = useState<Did[]>([]);
  const [form, setForm] = useState({
    number: "", description: "", dest_type: "extension", dest_value: "",
  });
  const [err, setErr] = useState("");

  const base = `/api/tenants/${tid}/dids`;
  async function load() { setList(await api.get<Did[]>(base)); }
  useEffect(() => { load(); }, [tid]);

  async function create(e: React.FormEvent) {
    e.preventDefault(); setErr("");
    try { await api.post(base, form); setForm({ ...form, number: "", description: "", dest_value: "" }); load(); }
    catch (e: any) { setErr(e.message); }
  }
  async function remove(id: number) {
    if (!confirm("Delete DID?")) return;
    await api.del(`${base}/${id}`); load();
  }

  return (
    <div>
      <h2>Inbound Numbers (DIDs)</h2>
      <div className="grid2">
        <div className="card">
          <h3>Map a number</h3>
          <form className="form" onSubmit={create}>
            <label>Number (E.164)<input value={form.number}
              onChange={(e) => setForm({ ...form, number: e.target.value })}
              placeholder="+13105551234" required /></label>
            <label>Description<input value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
            <label>Route to
              <select value={form.dest_type}
                onChange={(e) => setForm({ ...form, dest_type: e.target.value })}>
                {DEST_TYPES.map((d) => <option key={d} value={d}>{d}</option>)}
              </select></label>
            <label>Destination value<input value={form.dest_value}
              onChange={(e) => setForm({ ...form, dest_value: e.target.value })}
              placeholder="1001 / 600 / 500 …" required /></label>
            {err && <div className="error">{err}</div>}
            <button className="btn">Add DID</button>
          </form>
        </div>

        <div className="card">
          <h3>{list.length} numbers</h3>
          <table>
            <thead><tr><th>Number</th><th>Routes to</th><th>Desc</th><th></th></tr></thead>
            <tbody>
              {list.map((d) => (
                <tr key={d.id}>
                  <td>{d.number}</td>
                  <td>{d.dest_type} → <b>{d.dest_value}</b></td>
                  <td className="small muted">{d.description}</td>
                  <td><button className="btn small danger" onClick={() => remove(d.id)}>Delete</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
