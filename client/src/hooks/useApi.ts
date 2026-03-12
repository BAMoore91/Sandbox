import { useAuth } from './useAuth';

export function useApi() {
  const { token, activeOrgId } = useAuth();

  async function request<T>(
    path: string,
    options: RequestInit & { orgId?: string } = {}
  ): Promise<T> {
    const orgId = options.orgId ?? activeOrgId ?? undefined;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (orgId) headers['X-Org-Id'] = orgId;

    const res = await fetch(path, { ...options, headers });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error((body as { error?: string }).error ?? res.statusText);
    }
    return res.json() as Promise<T>;
  }

  return {
    get: <T>(path: string, opts?: RequestInit) =>
      request<T>(path, { method: 'GET', ...opts }),

    post: <T>(path: string, body: unknown, opts?: RequestInit) =>
      request<T>(path, {
        method: 'POST',
        body: JSON.stringify(body),
        ...opts,
      }),

    patch: <T>(path: string, body: unknown, opts?: RequestInit) =>
      request<T>(path, {
        method: 'PATCH',
        body: JSON.stringify(body),
        ...opts,
      }),

    delete: <T>(path: string, opts?: RequestInit) =>
      request<T>(path, { method: 'DELETE', ...opts }),
  };
}
