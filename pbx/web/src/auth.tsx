import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { api, getToken, setToken } from "./api";

interface Me {
  id: number;
  email: string;
  full_name: string | null;
  role: string;
  tenant_id: number | null;
}

interface AuthCtx {
  me: Me | null;
  loading: boolean;
  login: (email: string, password: string, tenantSlug?: string) => Promise<void>;
  logout: () => void;
}

const Ctx = createContext<AuthCtx>(null!);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!getToken()) {
      setLoading(false);
      return;
    }
    api
      .get<Me>("/api/auth/me")
      .then(setMe)
      .catch(() => setToken(null))
      .finally(() => setLoading(false));
  }, []);

  async function login(email: string, password: string, tenantSlug?: string) {
    const r = await api.post<{ access_token: string }>("/api/auth/login", {
      email,
      password,
      tenant_slug: tenantSlug || null,
    });
    setToken(r.access_token);
    const profile = await api.get<Me>("/api/auth/me");
    setMe(profile);
  }

  function logout() {
    setToken(null);
    setMe(null);
    window.location.href = "/login";
  }

  return (
    <Ctx.Provider value={{ me, loading, login, logout }}>{children}</Ctx.Provider>
  );
}
