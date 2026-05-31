import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api";

interface Row {
  calldate: string; src: string; dst: string; direction: string;
  did: string | null; billsec: number; disposition: string;
}

export default function Cdr() {
  const { tid } = useParams();
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [dir, setDir] = useState("");

  async function load() {
    const q = dir ? `?direction=${dir}` : "";
    const r = await api.get<{ total: number; items: Row[] }>(
      `/api/tenants/${tid}/cdr${q}`
    );
    setRows(r.items); setTotal(r.total);
  }
  useEffect(() => { load(); }, [tid, dir]);

  return (
    <div>
      <h2>Call Logs <span className="muted small">({total})</span></h2>
      <div className="toolbar">
        {["", "inbound", "outbound", "internal"].map((d) => (
          <button key={d} className={"btn small " + (dir === d ? "" : "ghost")}
            onClick={() => setDir(d)}>{d || "all"}</button>
        ))}
      </div>
      <div className="card">
        <table>
          <thead><tr><th>When</th><th>Dir</th><th>From</th><th>To</th><th>DID</th><th>Sec</th><th>Result</th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td className="small">{new Date(r.calldate).toLocaleString()}</td>
                <td><span className="pill">{r.direction}</span></td>
                <td>{r.src}</td>
                <td>{r.dst}</td>
                <td className="small">{r.did || "—"}</td>
                <td>{r.billsec}</td>
                <td className="small">{r.disposition}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
