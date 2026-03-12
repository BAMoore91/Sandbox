import { createContext, useState, useCallback, type ReactNode } from 'react';
import { loadAuth, saveAuth, clearAuth, type AuthState, type OrgMembership } from '../store/auth';

interface AuthContextValue extends AuthState {
  login: (token: string, user: AuthState['user'], orgs: OrgMembership[], defaultOrgId?: string) => void;
  logout: () => void;
  setActiveOrg: (orgId: string) => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(loadAuth);

  const login = useCallback(
    (token: string, user: AuthState['user'], orgs: OrgMembership[], defaultOrgId?: string) => {
      const next: AuthState = {
        token,
        user,
        orgs,
        activeOrgId: defaultOrgId ?? orgs[0]?.org_id ?? null,
      };
      saveAuth(next);
      setState(next);
    },
    []
  );

  const logout = useCallback(() => {
    clearAuth();
    setState({ token: null, user: null, orgs: [], activeOrgId: null });
  }, []);

  const setActiveOrg = useCallback((orgId: string) => {
    setState((prev) => {
      const next = { ...prev, activeOrgId: orgId };
      saveAuth(next);
      return next;
    });
  }, []);

  return (
    <AuthContext.Provider value={{ ...state, login, logout, setActiveOrg }}>
      {children}
    </AuthContext.Provider>
  );
}
