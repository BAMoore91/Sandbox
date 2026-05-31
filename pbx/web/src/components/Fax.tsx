import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { api, getToken } from "../api";

// Fax: per-DID fax boxes (inbound fax-to-email), outbound send-fax (PDF upload),
// and job history with PDF download.
interface Box {
  id: number; number: string; name: string | null;
  email: string | null; header: string | null; enabled: boolean;
}
interface Job {
  id: number; direction: string; faxbox: string | null; src: string | null;
  dst: string | null; status: string; pages: number | null;
  error: string | null; created_at: string; has_pdf: boolean;
}

export default function Fax() {
  const { tid } = useParams();
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [box, setBox] = useState({ number: "", name: "", email: "", header: "" });
  const [send, setSend] = useState({ to_number: "", caller_id: "", header: "" });
  const [file, setFile] = useState<File | null>(null);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const base = `/api/tenants/${tid}/fax`;

  async function load() {
    setBoxes(await api.get<Box[]>(`${base}/boxes`));
    setJobs(await api.get<Job[]>(base));
  }
  useEffect(() => { load(); const i = setInterval(load, 8000); return () => clearInterval(i); }, [tid]);

  async function addBox(e: React.FormEvent) {
    e.preventDefault(); setErr(""); setMsg("");
    try { await api.post(`${base}/boxes`, box); setBox({ number: "", name: "", email: "", header: "" }); load(); }
    catch (e: any) { setErr(e.message); }
  }
  async function delBox(id: number) {
    if (!confirm("Delete fax box?")) return;
    await api.del(`${base}/boxes/${id}`); load();
  }
  async function sendFax(e: React.FormEvent) {
    e.preventDefault(); setErr(""); setMsg("");
    if (!file) { setErr("Choose a PDF to send"); return; }
    try {
      const fd = new FormData();
      fd.append("to_number", send.to_number);
      fd.append("caller_id", send.caller_id);
      if (send.header) fd.append("header", send.header);
      fd.append("file", file);
      const r = await api.upload<any>(`${base}/send`, fd);
      setMsg(`Fax queued (job ${r.fax_id}) — sending…`);
      setFile(null); if (fileRef.current) fileRef.current.value = "";
      load();
    } catch (e: any) { setErr(typeof e.message === "string" ? e.message : JSON.stringify(e.message)); }
  }
  async function download(id: number) {
    const res = await fetch(`${base}/${id}/pdf`, { headers: { Authorization: `Bearer ${getToken()}` } });
    if (!res.ok) { setErr("PDF not available"); return; }
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a"); a.href = url; a.download = `fax-${id}.pdf`; a.click();
    URL.revokeObjectURL(url);
  }

  const pill = (s: string) =>
    s === "received" || s === "sent" ? "active" : s === "failed" ? "suspended" : "";

  return (
    <div>
      <h2>Fax</h2>
      <p className="muted">
        Inbound faxes are received and emailed as PDF to the fax box (point a
        number's DID at <code>fax → &lt;box number&gt;</code>). Send outbound by
        uploading a PDF. Uses T.38 over your SIP trunk.
      </p>
      {msg && <div className="callout">{msg}</div>}
      {err && <div className="error">{err}</div>}

      <div className="grid2">
        <div className="card">
          <h3>Fax boxes (inbound → email)</h3>
          <form className="form" onSubmit={addBox}>
            <div className="row2">
              <label>Box number<input value={box.number} placeholder="7000"
                onChange={(e) => setBox({ ...box, number: e.target.value })} required /></label>
              <label>Name<input value={box.name}
                onChange={(e) => setBox({ ...box, name: e.target.value })} /></label>
            </div>
            <label>Deliver to email(s) (comma-separated)
              <input value={box.email} placeholder="fax@company.com"
                onChange={(e) => setBox({ ...box, email: e.target.value })} /></label>
            <label>Header / station ID<input value={box.header}
              onChange={(e) => setBox({ ...box, header: e.target.value })} /></label>
            <button className="btn">Add fax box</button>
          </form>
          <table>
            <thead><tr><th>Box</th><th>Email</th><th></th></tr></thead>
            <tbody>
              {boxes.map((b) => (
                <tr key={b.id}>
                  <td>{b.number}<div className="small muted">{b.name}</div></td>
                  <td className="small">{b.email}</td>
                  <td><button className="btn small danger" onClick={() => delBox(b.id)}>✕</button></td>
                </tr>
              ))}
              {boxes.length === 0 && <tr><td colSpan={3} className="muted">No fax boxes.</td></tr>}
            </tbody>
          </table>
        </div>

        <div className="card">
          <h3>Send a fax</h3>
          <form className="form" onSubmit={sendFax}>
            <label>To (number)<input value={send.to_number} placeholder="+13105551234"
              onChange={(e) => setSend({ ...send, to_number: e.target.value })} required /></label>
            <label>From (caller ID, your DID)<input value={send.caller_id} placeholder="+15550001000"
              onChange={(e) => setSend({ ...send, caller_id: e.target.value })} required /></label>
            <label>Header (optional)<input value={send.header}
              onChange={(e) => setSend({ ...send, header: e.target.value })} /></label>
            <label>PDF to fax
              <input ref={fileRef} type="file" accept="application/pdf,.pdf"
                onChange={(e) => setFile(e.target.files?.[0] || null)} required /></label>
            <button className="btn">Send fax</button>
          </form>
        </div>
      </div>

      <div className="card">
        <h3>Fax history</h3>
        <table>
          <thead><tr><th>When</th><th>Dir</th><th>From</th><th>To</th><th>Pages</th><th>Status</th><th>PDF</th></tr></thead>
          <tbody>
            {jobs.map((j) => (
              <tr key={j.id}>
                <td className="small">{new Date(j.created_at).toLocaleString()}</td>
                <td><span className="pill">{j.direction}</span></td>
                <td>{j.src || "—"}</td>
                <td>{j.dst || "—"}</td>
                <td>{j.pages ?? "—"}</td>
                <td><span className={"pill " + pill(j.status)} title={j.error || ""}>{j.status}</span></td>
                <td>{j.has_pdf && <button className="btn small ghost" onClick={() => download(j.id)}>⬇</button>}</td>
              </tr>
            ))}
            {jobs.length === 0 && <tr><td colSpan={7} className="muted">No faxes yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
