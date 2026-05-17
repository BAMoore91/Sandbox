import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { ApiError } from "../api/client";

export function Login() {
  const { login, bootstrap, needsBootstrap } = useAuth();
  const navigate = useNavigate();
  const location = useLocation() as { state?: { from?: { pathname: string } } };
  const from = location.state?.from?.pathname ?? "/";

  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const isBootstrap = needsBootstrap === true;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (isBootstrap) {
        await bootstrap(email, displayName, password);
      } else {
        await login(email, password);
      }
      navigate(from, { replace: true });
    } catch (err) {
      if (err instanceof ApiError) setError(err.code);
      else setError("network_error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex h-screen items-center justify-center bg-zinc-950">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-xl border border-zinc-800 bg-zinc-900 p-6 shadow-lg"
      >
        <div className="mb-6 flex items-center gap-2">
          <div className="h-8 w-8 rounded bg-amber-500" />
          <div>
            <div className="text-lg font-semibold">SoftBiscuit</div>
            <div className="text-xs text-zinc-500">
              {isBootstrap ? "Create the admin account" : "Sign in"}
            </div>
          </div>
        </div>

        <label className="mb-3 block text-sm">
          <div className="mb-1 text-zinc-400">Email</div>
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 outline-none focus:border-amber-500"
          />
        </label>

        {isBootstrap && (
          <label className="mb-3 block text-sm">
            <div className="mb-1 text-zinc-400">Display name</div>
            <input
              type="text"
              required
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 outline-none focus:border-amber-500"
            />
          </label>
        )}

        <label className="mb-4 block text-sm">
          <div className="mb-1 text-zinc-400">Password</div>
          <input
            type="password"
            autoComplete={isBootstrap ? "new-password" : "current-password"}
            required
            minLength={isBootstrap ? 8 : 1}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 outline-none focus:border-amber-500"
          />
        </label>

        {error && (
          <div className="mb-3 rounded bg-red-950/60 px-3 py-2 text-sm text-red-300">
            {error === "invalid_credentials"
              ? "Invalid email or password."
              : error === "email_in_use"
                ? "That email is already registered."
                : "Something went wrong. Try again."}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded bg-amber-500 px-3 py-2 font-medium text-zinc-950 hover:bg-amber-400 disabled:opacity-50"
        >
          {submitting
            ? "…"
            : isBootstrap
              ? "Create admin account"
              : "Sign in"}
        </button>
      </form>
    </div>
  );
}
