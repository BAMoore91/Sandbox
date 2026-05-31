import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth";

export default function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [tenant, setTenant] = useState("");
  const [superMode, setSuperMode] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      await login(email, password, superMode ? undefined : tenant);
      nav("/");
    } catch (e: any) {
      setErr(e.message || "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="center">
      <form className="card login" onSubmit={submit}>
        <h1>☎ OpenPBX</h1>
        <p className="muted">Multi-tenant phone system console</p>

        {!superMode && (
          <label>
            Company (slug)
            <input value={tenant} onChange={(e) => setTenant(e.target.value)}
                   placeholder="acme" required={!superMode} />
          </label>
        )}
        <label>
          Email
          <input type="email" value={email}
                 onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          Password
          <input type="password" value={password}
                 onChange={(e) => setPassword(e.target.value)} required />
        </label>

        {err && <div className="error">{err}</div>}
        <button className="btn" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
        <button type="button" className="btn ghost"
                onClick={() => setSuperMode((s) => !s)}>
          {superMode ? "Company login" : "Platform admin login"}
        </button>
      </form>
    </div>
  );
}
