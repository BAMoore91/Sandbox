/** Minimal auth state using localStorage + React context. */

export interface AuthUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
}

export interface OrgMembership {
  org_id: string;
  name: string;
  slug: string;
  role: string;
}

export interface AuthState {
  token: string | null;
  user: AuthUser | null;
  orgs: OrgMembership[];
  activeOrgId: string | null;
}

const STORAGE_KEY = 'doorman_auth';

export function loadAuth(): AuthState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as AuthState;
  } catch {
    // ignore
  }
  return { token: null, user: null, orgs: [], activeOrgId: null };
}

export function saveAuth(state: AuthState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function clearAuth() {
  localStorage.removeItem(STORAGE_KEY);
}
