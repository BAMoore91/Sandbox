import { ReactNode } from "react";
import { Link, useParams, useLocation } from "react-router-dom";
import { useAuth } from "../auth";

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
          ["Users & Roles", `/t/${tid}/users`],
          ["Extensions", `/t/${tid}/extensions`],
          ["Auto-Attendant", `/t/${tid}/ivrs`],
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
      <main className="content">{children}</main>
    </div>
  );
}
