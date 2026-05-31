import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api, getToken } from "../api";

// Admin: this company's metered usage + invoice for a chosen month, with CSV
// download and a "finalize" snapshot.
interface LineItem {
  label: string;
  qty: number;
  unit_cents: number;
  amount_cents: number;
}
interface Invoice {
  period_start: string;
  period_end: string;
  total_cents: number;
  total_display: string;
  usage: Record<string, number>;
  line_items: LineItem[];
}

const now = new Date();

export default function Billing() {
  const { tid } = useParams();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [inv, setInv] = useState<Invoice | null>(null);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const base = `/api/tenants/${tid}/billing`;
  async function load() {
    setErr("");
    try {
      setInv(await api.get<Invoice>(`${base}/invoice?year=${year}&month=${month}`));
    } catch (e: any) {
      setErr(e.message);
    }
  }
  useEffect(() => {
    load();
  }, [tid, year, month]);

  async function downloadCsv() {
    const res = await fetch(`${base}/invoice?year=${year}&month=${month}&format=csv`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    if (!res.ok) return;
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = url;
    a.download = `invoice-${year}-${String(month).padStart(2, "0")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function finalize() {
    setMsg("");
    setErr("");
    try {
      const r = await api.post<any>(`${base}/invoice/finalize?year=${year}&month=${month}`);
      setMsg(`Invoice finalized: $${(r.total_cents / 100).toFixed(2)}.`);
    } catch (e: any) {
      setErr(e.message);
    }
  }

  const dollars = (c: number) => `$${(c / 100).toFixed(2)}`;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  return (
    <div>
      <h2>Billing &amp; Usage</h2>
      {msg && <div className="callout">{msg}</div>}
      {err && <div className="error">{err}</div>}

      <div className="toolbar">
        <select value={month} onChange={(e) => setMonth(+e.target.value)}>
          {months.map((m, i) => (
            <option key={i} value={i + 1}>
              {m}
            </option>
          ))}
        </select>
        <select value={year} onChange={(e) => setYear(+e.target.value)}>
          {[year + 1, year, year - 1, year - 2].map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
        <button className="btn small" onClick={downloadCsv}>
          Download CSV
        </button>
        <button className="btn small ghost" onClick={finalize}>
          Finalize
        </button>
      </div>

      {inv && (
        <div className="grid2">
          <div className="card">
            <h3>Usage</h3>
            <table>
              <tbody>
                <tr><td>Outbound minutes</td><td>{inv.usage.outbound_minutes}</td></tr>
                <tr><td>Inbound minutes</td><td>{inv.usage.inbound_minutes}</td></tr>
                <tr><td>Outbound calls</td><td>{inv.usage.outbound_calls}</td></tr>
                <tr><td>Inbound calls</td><td>{inv.usage.inbound_calls}</td></tr>
                <tr><td>Internal calls</td><td>{inv.usage.internal_calls}</td></tr>
                <tr><td>Extensions</td><td>{inv.usage.extensions}</td></tr>
              </tbody>
            </table>
          </div>

          <div className="card">
            <h3>
              Invoice <span className="muted small">{inv.period_start} → {inv.period_end}</span>
            </h3>
            <table>
              <thead>
                <tr><th>Item</th><th>Qty</th><th>Unit</th><th>Amount</th></tr>
              </thead>
              <tbody>
                {inv.line_items.map((it, i) => (
                  <tr key={i}>
                    <td>{it.label}</td>
                    <td>{it.qty}</td>
                    <td>{dollars(it.unit_cents)}</td>
                    <td>{dollars(it.amount_cents)}</td>
                  </tr>
                ))}
                <tr>
                  <td colSpan={3}><b>Total</b></td>
                  <td><b>{dollars(inv.total_cents)}</b></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
