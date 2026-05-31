import { ReactNode, useEffect, useState } from "react";
import { Link, useParams, useLocation } from "react-router-dom";
import { useAuth } from "../auth";
import { api } from "../api";

export default function Layout({ children }: { children: ReactNode }) {
  const { me, logout } = useAuth();
  const { tid } = useParams();
  const loc = useLocation();

  // Agents get a single self-service link; admins get the full console.
  const isAgent = me?.role === "agent";
  const tenantNav =
    tid && !isAgent
      ? [
          ["Dashboard", `/t/${tid}/dashboard`],
          ["Wallboard", `/t/${tid}/wallboard`],
          ["Users & Roles", `/t/${tid}/users`],
          ["Extensions", `/t/${tid}/extensions`],
          ["Phones", `/t/${tid}/phones`],
          ["Auto-Attendant", `/t/${tid}/ivrs`],
          ["Flows", `/t/${tid}/flows`],
          ["Fax", `/t/${tid}/fax`],
          ["Ring Groups", `/t/${tid}/ring-groups`],
          ["Queues", `/t/${tid}/queues`],
          ["Schedules", `/t/${tid}/schedules`],
          ["Prompts", `/t/${tid}/prompts`],
          ["Inbound (DIDs)", `/t/${tid}/dids`],
          ["Outbound Rules", `/t/${tid}/outbound`],
          ["Trunks", `/t/${tid}/trunks`],
          ["Call Logs", `/t/${tid}/cdr`],
          ["Recordings", `/t/${tid}/recordings`],
          ["Notifications", `/t/${tid}/notifications`],
          ["Billing & Usage", `/t/${tid}/billing`],
          ["Settings", `/t/${tid}/settings`],
          ["Softphone", `/t/${tid}/softphone`],
        ]
      : [];

  const agentNav = isAgent
    ? [
        ["My Phone", "/me"],
        ["Softphone", "/me/softphone"],
      ]
    : [];

  // When a global admin is managing a specific company, show which one.
  const [tenantName, setTenantName] = useState<string | null>(null);
  useEffect(() => {
    if (tid && me?.role === "superadmin") {
      api.get<any>(`/api/tenants/${tid}`)
        .then((t) => setTenantName(t.name))
        .catch(() => setTenantName(null));
    } else {
      setTenantName(null);
    }
  }, [tid, me]);
  const impersonating = !!(tid && me?.role === "superadmin");

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">☎ OpenPBX</div>
        {me?.role === "superadmin" && (
          <>
            <Link className="navlink" to="/tenants">
              All Companies
            </Link>
            <Link className="navlink" to="/platform-billing">
              Platform Billing
            </Link>
          </>
        )}
        {[...tenantNav, ...agentNav].map(([label, to]) => (
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
      <main className="content">
        {impersonating && (
          <div className="managing-bar">
            <span>
              🛠 Managing company:{" "}
              <b>{tenantName || `#${tid}`}</b>{" "}
              <span className="muted small">as global admin</span>
            </span>
            <Link className="btn small ghost" to="/tenants">
              ← Back to all companies
            </Link>
          </div>
        )}
        {children}
      </main>
    </div>
  );
}
