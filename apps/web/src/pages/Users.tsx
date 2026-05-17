import { useEffect, useState } from "react";
import { api } from "../api/client";

interface UserRow {
  id: string;
  email: string;
  displayName: string;
  role: "admin" | "viewer";
  disabled: boolean;
  createdAt: number;
  lastLoginAt: number | null;
}

export function Users() {
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ users: UserRow[] }>("/users")
      .then((r) => setUsers(r.users))
      .catch((e) => setError(String(e)));
  }, []);

  return (
    <div className="p-6">
      <h1 className="mb-4 text-2xl font-semibold">Users</h1>
      {error && <div className="text-red-400">{error}</div>}
      {!users && !error && <div className="text-zinc-500">Loading…</div>}
      {users && (
        <table className="w-full text-sm">
          <thead className="text-left text-zinc-400">
            <tr>
              <th className="py-2">Email</th>
              <th>Name</th>
              <th>Role</th>
              <th>Last login</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-t border-zinc-800">
                <td className="py-2">{u.email}</td>
                <td>{u.displayName}</td>
                <td>{u.role}</td>
                <td className="text-zinc-500">
                  {u.lastLoginAt
                    ? new Date(u.lastLoginAt).toLocaleString()
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
