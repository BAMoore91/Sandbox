import { ReactNode } from "react";
import { Link, useParams, useLocation } from "react-router-dom";
import { useAuth } from "../auth";

export default function Layout({ children }: { children: ReactNode }) {
  const { me, logout } = useAuth();
  const { tid } = useParams();
  const loc = useLocation();

  const tenantNav = tid
    ? [
        ["Dashboard", `/t/${tid}/dashboard`],
        ["Extensions", `/t/${tid}/extensions`],
        ["Trunks", `/t/${tid}/trunks`],
        ["Inbound (DIDs)", `/t/${tid}/dids`],
        ["Call Logs", `/t/${tid}/cdr`],
        ["Softphone", `/t/${tid}/softphone`],
      ]
    : [];

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">☎ OpenPBX</div>
        {me?.role === "superadmin" && (
          <Link className="navlink" to="/tenants">
            All Companies
          </Link>
        )}
        {tenantNav.map(([label, to]) => (
          <Link
            key={to}
            to={to}
            className={"navlink" + (loc.pathname === to ? " active" : "")}
          >
            {label}
          </Link>
        ))}
        <div className="spacer" />
        <div className="userbox">
          <div className="muted small">{me?.email}</div>
          <div className="muted small">role: {me?.role}</div>
          <button className="btn ghost" onClick={logout}>
            Sign out
          </button>
        </div>
      </aside>
      <main className="content">{children}</main>
    </div>
  );
}
