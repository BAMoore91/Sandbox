import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api";
import { useFormError } from "./flow";

// Admin page: manage the company's portal logins (admins + agents) and link
// each agent to an extension so they get a self-service "My Phone" view.
interface User {
  id: number;
  email: string;
  full_name: string | null;
  role: string;
  extension: string | null;
  is_active: boolean;
  last_login_at: string | null;
}
interface Ext {
  extension: string;
  display_name: string;
}

const BLANK = { email: "", password: "", full_name: "", role: "agent", extension: "" };

export default function Users() {
  const { tid } = useParams();
  const [list, setList] = useState<User[]>([]);
  const [exts, setExts] = useState<Ext[]>([]);
  const [form, setForm] = useState<any>(BLANK);
  const { err, setErr, node } = useFormError();

  const base = `/api/tenants/${tid}/users`;
  async function load() {
    setList(await api.get<User[]>(base));
    try {
      setExts(await api.get<Ext[]>(`/api/tenants/${tid}/extensions`));
    } catch {
      /* ignore */
    }
  }
  useEffect(() => {
    load();
  }, [tid]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    try {
      await api.post(base, {
        ...form,
        extension: form.role === "agent" ? form.extension || null : null,
      });
      setForm(BLANK);
      load();
    } catch (e: any) {
      setErr(e.message);
    }
  }

  async function setRole(u: User, role: string) {
    await api.patch(`${base}/${u.id}`, { role });
    load();
  }
  async function link(u: User, extension: string) {
    await api.patch(`${base}/${u.id}`, { extension });
    load();
  }
  async function toggleActive(u: User) {
    await api.patch(`${base}/${u.id}`, { is_active: !u.is_active });
    load();
  }
  async function remove(u: User) {
    if (!confirm(`Delete login ${u.email}?`)) return;
    await api.del(`${base}/${u.id}`);
    load();
  }

  return (
    <div>
      <h2>Users &amp; Roles</h2>
      <p className="muted">
        <b>Admins</b> manage the whole company. <b>Agents</b> only get a
        self-service “My Phone” portal for the extension you link them to.
      </p>
      <div className="grid2">
        <div className="card">
          <h3>Add user</h3>
          <form className="form" onSubmit={create}>
            <label>
              Email
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                required
              />
            </label>
            <label>
              Full name
              <input
                value={form.full_name}
                onChange={(e) => setForm({ ...form, full_name: e.target.value })}
              />
            </label>
            <label>
              Temporary password
              <input
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                required
              />
            </label>
            <label>
              Role
              <select
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value })}
              >
                <option value="agent">Agent (self-service only)</option>
                <option value="admin">Admin (full control)</option>
              </select>
            </label>
            {form.role === "agent" && (
              <label>
                Link to extension
                <select
                  value={form.extension}
                  onChange={(e) => setForm({ ...form, extension: e.target.value })}
                >
                  <option value="">— none —</option>
                  {exts.map((x) => (
                    <option key={x.extension} value={x.extension}>
                      {x.extension} · {x.display_name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {node}
            <button className="btn">Create user</button>
          </form>
        </div>

        <div className="card">
          <h3>{list.length} users</h3>
          <table>
            <thead>
              <tr>
                <th>Email</th>
                <th>Role</th>
                <th>Extension</th>
                <th>Active</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {list.map((u) => (
                <tr key={u.id} style={{ opacity: u.is_active ? 1 : 0.5 }}>
                  <td>
                    {u.email}
                    <div className="small muted">{u.full_name}</div>
                  </td>
                  <td>
                    <select value={u.role} onChange={(e) => setRole(u, e.target.value)}>
                      <option value="agent">agent</option>
                      <option value="admin">admin</option>
                    </select>
                  </td>
                  <td>
                    {u.role === "agent" ? (
                      <select
                        value={u.extension || ""}
                        onChange={(e) => link(u, e.target.value)}
                      >
                        <option value="">— none —</option>
                        {exts.map((x) => (
                          <option key={x.extension} value={x.extension}>
                            {x.extension}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="muted small">n/a</span>
                    )}
                  </td>
                  <td>
                    <button className="btn small ghost" onClick={() => toggleActive(u)}>
                      {u.is_active ? "disable" : "enable"}
                    </button>
                  </td>
                  <td>
                    <button className="btn small danger" onClick={() => remove(u)}>
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
