import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

const nav = [
  { to: "/", label: "Live", end: true },
  { to: "/timeline", label: "Timeline" },
  { to: "/events", label: "Events" },
  { to: "/cameras", label: "Cameras" },
  { to: "/users", label: "Users", adminOnly: true },
  { to: "/settings", label: "Settings" },
];

export function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <aside className="flex w-56 flex-col border-r border-zinc-800 bg-zinc-900">
        <div className="flex items-center gap-2 border-b border-zinc-800 px-4 py-3">
          <div className="h-6 w-6 rounded bg-amber-500" />
          <span className="font-semibold">SoftBiscuit</span>
        </div>
        <nav className="flex flex-1 flex-col gap-1 p-2">
          {nav
            .filter((n) => !n.adminOnly || user?.role === "admin")
            .map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={({ isActive }) =>
                  `rounded px-3 py-2 text-sm transition ${
                    isActive
                      ? "bg-zinc-800 text-white"
                      : "text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-100"
                  }`
                }
              >
                {n.label}
              </NavLink>
            ))}
        </nav>
        <div className="border-t border-zinc-800 p-3 text-xs">
          <div className="font-medium text-zinc-200">{user?.displayName}</div>
          <div className="text-zinc-500">{user?.email}</div>
          <button
            onClick={() => {
              logout();
              navigate("/login");
            }}
            className="mt-2 w-full rounded bg-zinc-800 px-2 py-1 text-zinc-300 hover:bg-zinc-700"
          >
            Sign out
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-auto bg-zinc-950">
        <Outlet />
      </main>
    </div>
  );
}
