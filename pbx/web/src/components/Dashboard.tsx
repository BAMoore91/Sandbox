import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api";

interface Reg { extension: string; display_name: string; online: boolean; user_agent: string | null; }
interface Summary { inbound: number; outbound: number; internal: number; answered: number; total_billsec: number; }

export default function Dashboard() {
  const { tid } = useParams();
  const [regs, setRegs] = useState<Reg[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [tenant, setTenant] = useState<any>(null);

  async function load() {
    setTenant(await api.get(`/api/tenants/${tid}`));
    setRegs(await api.get<Reg[]>(`/api/tenants/${tid}/status/registrations`));
    setSummary(await api.get<Summary>(`/api/tenants/${tid}/cdr/summary`));
  }
  useEffect(() => { load(); const i = setInterval(load, 10000); return () => clearInterval(i); }, [tid]);

  const online = regs.filter((r) => r.online).length;

  return (
    <div>
      <h2>{tenant?.name} <span className="muted small">({tenant?.slug})</span></h2>
      <div className="stats">
        <div className="stat"><div className="num">{online}/{regs.length}</div><div>Phones online</div></div>
        <div className="stat"><div className="num">{summary?.inbound ?? 0}</div><div>Inbound (30d)</div></div>
        <div className="stat"><div className="num">{summary?.outbound ?? 0}</div><div>Outbound (30d)</div></div>
        <div className="stat"><div className="num">{Math.round((summary?.total_billsec ?? 0) / 60)}</div><div>Talk minutes (30d)</div></div>
      </div>

      <div className="card">
        <h3>Extension status</h3>
        <table>
          <thead><tr><th>Ext</th><th>Name</th><th>Status</th><th>User agent</th></tr></thead>
          <tbody>
            {regs.map((r) => (
              <tr key={r.extension}>
                <td>{r.extension}</td>
                <td>{r.display_name}</td>
                <td><span className={"pill " + (r.online ? "active" : "suspended")}>
                  {r.online ? "online" : "offline"}</span></td>
                <td className="muted small">{r.user_agent || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
