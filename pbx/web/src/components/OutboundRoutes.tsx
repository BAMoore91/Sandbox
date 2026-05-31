import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api";
import { useFormError } from "./flow";

interface Route {
  id: number;
  name: string;
  priority: number;
  pattern: string;
  regexp: string;
  trunk_id: number;
  strip_digits: number;
  prepend: string;
  caller_id: string | null;
  enabled: boolean;
}
interface Trunk {
  id: number;
  name: string;
}

const BLANK = {
  name: "",
  pattern: "_1NXXNXXXXXX",
  trunk_id: 0,
  priority: 100,
  strip_digits: 0,
  prepend: "",
  caller_id: "",
  enabled: true,
};

export default function OutboundRoutes() {
  const { tid } = useParams();
  const [list, setList] = useState<Route[]>([]);
  const [trunks, setTrunks] = useState<Trunk[]>([]);
  const [form, setForm] = useState<any>(BLANK);
  const [editId, setEditId] = useState<number | null>(null);
  const { err, setErr, node } = useFormError();

  const base = `/api/tenants/${tid}/outbound-routes`;
  async function load() {
    setList(await api.get<Route[]>(base));
    const t = await api.get<Trunk[]>(`/api/tenants/${tid}/trunks`);
    setTrunks(t);
    if (t.length && !form.trunk_id) setForm((f: any) => ({ ...f, trunk_id: t[0].id }));
  }
  useEffect(() => {
    load();
  }, [tid]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    try {
      const body = { ...form, caller_id: form.caller_id || null };
      if (editId) await api.patch(`${base}/${editId}`, body);
      else await api.post(base, body);
      setForm({ ...BLANK, trunk_id: trunks[0]?.id || 0 });
      setEditId(null);
      load();
    } catch (e: any) {
      setErr(e.message);
    }
  }
  function edit(r: Route) {
    setEditId(r.id);
    setForm({ ...r, caller_id: r.caller_id || "" });
    window.scrollTo(0, 0);
  }
  async function remove(id: number) {
    if (!confirm("Delete this outbound rule?")) return;
    await api.del(`${base}/${id}`);
    load();
  }

  return (
    <div>
      <h2>Outbound Rules</h2>
      <p className="muted">
        Decide which dialed numbers go out which trunk, what caller ID they
        present, and any digit manipulation. Lower priority is matched first.
      </p>
      <div className="grid2">
        <div className="card">
          <h3>{editId ? "Edit rule" : "Create rule"}</h3>
          <form className="form" onSubmit={save}>
            <label>
              Name
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="US Long Distance"
                required
              />
            </label>
            <label>
              Dial pattern (Asterisk style; _ prefix, X=0-9, N=2-9, .=rest)
              <input
                value={form.pattern}
                onChange={(e) => setForm({ ...form, pattern: e.target.value })}
                placeholder="_1NXXNXXXXXX"
                required
              />
            </label>
            <label>
              Trunk
              <select
                value={form.trunk_id}
                onChange={(e) => setForm({ ...form, trunk_id: +e.target.value })}
              >
                {trunks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="row2">
              <label>
                Priority
                <input
                  type="number"
                  value={form.priority}
                  onChange={(e) => setForm({ ...form, priority: +e.target.value })}
                />
              </label>
              <label>
                Strip leading digits
                <input
                  type="number"
                  value={form.strip_digits}
                  onChange={(e) => setForm({ ...form, strip_digits: +e.target.value })}
                />
              </label>
            </div>
            <div className="row2">
              <label>
                Prepend
                <input
                  value={form.prepend}
                  onChange={(e) => setForm({ ...form, prepend: e.target.value })}
                  placeholder="+1"
                />
              </label>
              <label>
                Caller ID (E.164, must be a Twilio number)
                <input
                  value={form.caller_id}
                  onChange={(e) => setForm({ ...form, caller_id: e.target.value })}
                  placeholder="+13105551234"
                />
              </label>
            </div>
            <label className="row">
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
              />{" "}
              Enabled
            </label>
            {node}
            <div className="row2">
              <button className="btn">{editId ? "Save" : "Create"}</button>
              {editId && (
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => {
                    setEditId(null);
                    setForm({ ...BLANK, trunk_id: trunks[0]?.id || 0 });
                  }}
                >
                  Cancel
                </button>
              )}
            </div>
          </form>
        </div>

        <div className="card">
          <h3>{list.length} rules</h3>
          <table>
            <thead>
              <tr>
                <th>Pri</th>
                <th>Name</th>
                <th>Pattern</th>
                <th>Caller ID</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.id} style={{ opacity: r.enabled ? 1 : 0.5 }}>
                  <td>{r.priority}</td>
                  <td>{r.name}</td>
                  <td className="small">
                    <code>{r.pattern}</code>
                  </td>
                  <td className="small">{r.caller_id || "—"}</td>
                  <td className="nowrap">
                    <button className="btn small" onClick={() => edit(r)}>
                      Edit
                    </button>{" "}
                    <button className="btn small danger" onClick={() => remove(r.id)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
