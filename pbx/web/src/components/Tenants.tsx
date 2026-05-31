import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";

interface Tenant {
  id: number;
  slug: string;
  name: string;
  status: string;
  plan_name: string | null;
  ext_count: number;
}
interface Plan { code: string; name: string; }

export default function Tenants() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [form, setForm] = useState({
    slug: "", name: "", plan_code: "startup",
    admin_email: "", admin_password: "",
  });
  const [err, setErr] = useState("");

  async function load() {
    setTenants(await api.get<Tenant[]>("/api/tenants"));
    setPlans(await api.get<Plan[]>("/api/plans"));
  }
  useEffect(() => { load(); }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    try {
      await api.post("/api/tenants", form);
      setForm({ slug: "", name: "", plan_code: "startup", admin_email: "", admin_password: "" });
      load();
    } catch (e: any) { setErr(e.message); }
  }

  return (
    <div>
      <h2>Companies</h2>
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
          <h3>{tenants.length} companies</h3>
          <table>
            <thead><tr><th>Company</th><th>Slug</th><th>Plan</th><th>Exts</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {tenants.map((t) => (
                <tr key={t.id}>
                  <td>{t.name}</td>
                  <td><code>{t.slug}</code></td>
                  <td>{t.plan_name}</td>
                  <td>{t.ext_count}</td>
                  <td><span className={"pill " + t.status}>{t.status}</span></td>
                  <td><Link className="btn small" to={`/t/${t.id}/dashboard`}>Manage</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
