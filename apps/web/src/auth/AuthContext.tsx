import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api, setToken, getToken } from "../api/client";

export type Role = "admin" | "viewer";

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  role: Role;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  needsBootstrap: boolean | null;
  login: (email: string, password: string) => Promise<void>;
  bootstrap: (
    email: string,
    displayName: string,
    password: string,
  ) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [needsBootstrap, setNeedsBootstrap] = useState<boolean | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const status = await api<{ needsBootstrap: boolean }>(
          "/auth/bootstrap-status",
        );
        setNeedsBootstrap(status.needsBootstrap);
      } catch {
        setNeedsBootstrap(null);
      }
      if (getToken()) {
        try {
          const me = await api<{ user: AuthUser | null }>("/auth/me");
          if (me.user) setUser(me.user);
          else setToken(null);
        } catch {
          setToken(null);
        }
      }
      setLoading(false);
    })();
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      needsBootstrap,
      async login(email, password) {
        const res = await api<{ token: string; user: AuthUser }>(
          "/auth/login",
          {
            method: "POST",
            body: JSON.stringify({ email, password }),
          },
        );
        setToken(res.token);
        setUser(res.user);
        setNeedsBootstrap(false);
      },
      async bootstrap(email, displayName, password) {
        const res = await api<{ token: string; user: AuthUser }>(
          "/auth/register",
          {
            method: "POST",
            body: JSON.stringify({ email, displayName, password }),
          },
        );
        setToken(res.token);
        setUser(res.user);
        setNeedsBootstrap(false);
      },
      logout() {
        setToken(null);
        setUser(null);
      },
    }),
    [user, loading, needsBootstrap],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
