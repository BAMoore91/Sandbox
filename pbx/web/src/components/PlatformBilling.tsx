import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { api, getToken } from "../api";
import { useAuth } from "../auth";

// Super-admin: platform-wide billing run across all active tenants for a month.
interface Inv {
  tenant_slug: string;
  tenant_name: string;
  plan_code: string;
  total_cents: number;
  total_display: string;
  usage: Record<string, number>;
}
interface Run {
  period_start: string;
  period_end: string;
  tenant_count: number;
  grand_total_cents: number;
  invoices: Inv[];
}

const now = new Date();

export default function PlatformBilling() {
  const { me } = useAuth();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [run, setRun] = useState<Run | null>(null);
  const [err, setErr] = useState("");

  async function load() {
    setErr("");
    try {
      setRun(await api.get<Run>(`/api/billing/run?year=${year}&month=${month}`));
    } catch (e: any) {
      setErr(e.message);
    }
  }
  useEffect(() => {
    if (me?.role === "superadmin") load();
  }, [year, month]);

  if (me && me.role !== "superadmin") return <Navigate to="/" replace />;

  async function downloadCsv() {
    const res = await fetch(`/api/billing/run?year=${year}&month=${month}&format=csv`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    if (!res.ok) return;
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = url;
    a.download = `billing-run-${year}-${String(month).padStart(2, "0")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const dollars = (c: number) => `$${(c / 100).toFixed(2)}`;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  return (
    <div>
      <h2>Platform Billing</h2>
      {err && <div className="error">{err}</div>}
      <div className="toolbar">
        <select value={month} onChange={(e) => setMonth(+e.target.value)}>
          {months.map((m, i) => (
            <option key={i} value={i + 1}>{m}</option>
          ))}
        </select>
        <select value={year} onChange={(e) => setYear(+e.target.value)}>
          {[year + 1, year, year - 1, year - 2].map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
        <button className="btn small" onClick={downloadCsv}>Download CSV</button>
      </div>

      {run && (
        <>
          <div className="stats">
            <div className="stat">
              <div className="num">{run.tenant_count}</div>
              <div>Active companies</div>
            </div>
            <div className="stat">
              <div className="num">{dollars(run.grand_total_cents)}</div>
              <div>Grand total ({run.period_start})</div>
            </div>
          </div>
          <div className="card">
            <table>
              <thead>
                <tr>
                  <th>Company</th><th>Plan</th><th>Out min</th><th>In min</th>
                  <th>Exts</th><th>Total</th>
                </tr>
              </thead>
              <tbody>
                {run.invoices.map((i) => (
                  <tr key={i.tenant_slug}>
                    <td>{i.tenant_name} <span className="muted small">({i.tenant_slug})</span></td>
                    <td>{i.plan_code}</td>
                    <td>{i.usage.outbound_minutes}</td>
                    <td>{i.usage.inbound_minutes}</td>
                    <td>{i.usage.extensions}</td>
                    <td><b>{dollars(i.total_cents)}</b></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
