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
  const [history, setHistory] = useState<any[]>([]);
  const [settings, setSettings] = useState<any>(null);
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
  async function loadHistory() {
    try {
      setHistory(await api.get<any[]>(`${base}/invoices`));
      setSettings(await api.get<any>(`${base}/settings`));
    } catch {
      /* ignore */
    }
  }
  useEffect(() => {
    load();
  }, [tid, year, month]);
  useEffect(() => {
    loadHistory();
  }, [tid]);

  async function charge(id: number) {
    setErr("");
    setMsg("");
    try {
      const r = await api.post<any>(`${base}/invoices/${id}/charge`);
      setMsg(`Charge ${r.status} for invoice ${id}.`);
      loadHistory();
    } catch (e: any) {
      setErr(e.message);
    }
  }
  async function toggleAutoBill(on: boolean) {
    setErr("");
    try {
      setSettings(await api.put<any>(`${base}/settings`, { auto_bill: on }));
    } catch (e: any) {
      setErr(e.message);
    }
  }

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
      loadHistory();
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

      <div className="card">
        <h3>
          Finalized invoices
          {settings && (
            <span style={{ float: "right", fontSize: 13, fontWeight: 400 }}>
              {settings.stripe_enabled ? (
                <label className="row small">
                  <input
                    type="checkbox"
                    checked={!!settings.auto_bill}
                    onChange={(e) => toggleAutoBill(e.target.checked)}
                  />{" "}
                  Auto-charge monthly
                </label>
              ) : (
                <span className="muted small">Stripe not configured</span>
              )}
            </span>
          )}
        </h3>
        <table>
          <thead>
            <tr><th>Period</th><th>Total</th><th>Status</th><th></th></tr>
          </thead>
          <tbody>
            {history.map((h) => (
              <tr key={h.id}>
                <td className="small">{h.period_start} → {h.period_end}</td>
                <td>{dollars(h.total_cents)}</td>
                <td>
                  <span
                    className={
                      "pill " +
                      (h.status === "paid" ? "active" : h.status === "failed" ? "suspended" : "")
                    }
                    title={h.last_error || ""}
                  >
                    {h.status}
                  </span>
                </td>
                <td>
                  {settings?.stripe_enabled && h.status !== "paid" && h.total_cents > 0 && (
                    <button className="btn small" onClick={() => charge(h.id)}>
                      Charge
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {history.length === 0 && (
              <tr><td colSpan={4} className="muted">No finalized invoices yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
