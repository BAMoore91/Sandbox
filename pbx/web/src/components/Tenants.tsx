import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";

interface Tenant {
  id: number;
  slug: string;
  name: string;
  status: string;
  plan_name: string | null;
  plan_id: number | null;
  ext_count: number;
}
interface Plan { id: number; code: string; name: string; }

export default function Tenants() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [form, setForm] = useState({
    slug: "", name: "", plan_code: "startup",
    admin_email: "", admin_password: "",
  });
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [filter, setFilter] = useState("");

  async function load() {
    setTenants(await api.get<Tenant[]>("/api/tenants"));
    setPlans(await api.get<Plan[]>("/api/plans"));
  }
  useEffect(() => { load(); }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setErr(""); setMsg("");
    try {
      await api.post("/api/tenants", form);
      setForm({ slug: "", name: "", plan_code: "startup", admin_email: "", admin_password: "" });
      load();
    } catch (e: any) { setErr(e.message); }
  }

  async function suspend(t: Tenant) {
    await api.post(`/api/tenants/${t.id}/suspend`);
    setMsg(`${t.name} suspended.`);
    load();
  }
  async function activate(t: Tenant) {
    await api.post(`/api/tenants/${t.id}/activate`);
    setMsg(`${t.name} activated.`);
    load();
  }
  async function changePlan(t: Tenant, planCode: string) {
    await api.patch(`/api/tenants/${t.id}`, { plan_code: planCode });
    setMsg(`${t.name} moved to ${planCode}.`);
    load();
  }
  async function remove(t: Tenant) {
    if (!confirm(`Delete company "${t.name}" and ALL its data (extensions, numbers, recordings)? This cannot be undone.`)) return;
    if (prompt(`Type the slug "${t.slug}" to confirm deletion:`) !== t.slug) {
      setErr("Slug did not match — deletion cancelled.");
      return;
    }
    await api.del(`/api/tenants/${t.id}`);
    setMsg(`${t.name} deleted.`);
    load();
  }

  const planCodeOf = (t: Tenant) =>
    plans.find((p) => p.id === t.plan_id)?.code || "startup";
  const shown = tenants.filter((t) =>
    !filter || t.name.toLowerCase().includes(filter.toLowerCase()) ||
    t.slug.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div>
      <h2>Companies <span className="muted small">(global admin)</span></h2>
      {msg && <div className="callout">{msg}</div>}
      <div className="grid2">
        <div className="card">
          <h3>Provision a company</h3>
          <form onSubmit={create} className="form">
            <label>Slug<input value={form.slug}
              onChange={(e) => setForm({ ...form, slug: e.target.value })}
              placeholder="acme" required /></label>
            <label>Name<input value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })} required /></label>
            <label>Plan
              <select value={form.plan_code}
                onChange={(e) => setForm({ ...form, plan_code: e.target.value })}>
                {plans.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}
              </select>
            </label>
            <label>Admin email<input type="email" value={form.admin_email}
              onChange={(e) => setForm({ ...form, admin_email: e.target.value })} /></label>
            <label>Admin password<input type="password" value={form.admin_password}
              onChange={(e) => setForm({ ...form, admin_password: e.target.value })} /></label>
            {err && <div className="error">{err}</div>}
            <button className="btn">Create company</button>
          </form>
        </div>

        <div className="card">
          <div className="qhead">
            <h3>{tenants.length} companies</h3>
            <input style={{ width: 160 }} placeholder="filter…" value={filter}
              onChange={(e) => setFilter(e.target.value)} />
          </div>
          <table>
            <thead><tr><th>Company</th><th>Plan</th><th>Exts</th><th>Status</th><th>Manage</th><th>Actions</th></tr></thead>
            <tbody>
              {shown.map((t) => (
                <tr key={t.id} style={{ opacity: t.status === "suspended" ? 0.6 : 1 }}>
                  <td>{t.name}<div className="small muted"><code>{t.slug}</code></div></td>
                  <td>
                    <select value={planCodeOf(t)} onChange={(e) => changePlan(t, e.target.value)}>
                      {plans.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}
                    </select>
                  </td>
                  <td>{t.ext_count}</td>
                  <td><span className={"pill " + t.status}>{t.status}</span></td>
                  <td><Link className="btn small" to={`/t/${t.id}/dashboard`}>Manage →</Link></td>
                  <td className="nowrap">
                    {t.status === "active" ? (
                      <button className="btn small ghost" onClick={() => suspend(t)}>Suspend</button>
                    ) : (
                      <button className="btn small" onClick={() => activate(t)}>Activate</button>
                    )}{" "}
                    <button className="btn small danger" onClick={() => remove(t)}>Delete</button>
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
