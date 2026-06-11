/** Typed fetch helpers for REST API routes. */
import type { Settings, TagDef, CrashEvent } from '../../../server/src/types';

async function request<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${text}`);
  }
  return res.json() as Promise<T>;
}

// ── Auth ──────────────────────────────────────────────────────────────────────
export const auth = {
  login: (username: string, password: string) =>
    request<{ success: boolean; username: string }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  logout: () =>
    request<{ success: boolean }>('/api/auth/logout', { method: 'POST' }),
  me: () =>
    request<{ authenticated: boolean; username?: string }>('/api/auth/me'),
};

// ── Settings ──────────────────────────────────────────────────────────────────
export const settingsApi = {
  get: () => request<Settings>('/api/settings'),
  update: (data: Partial<Settings>) =>
    request<{ success: boolean; settings: Settings }>('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
};

// ── Tags ──────────────────────────────────────────────────────────────────────
export const tagsApi = {
  list: () => request<TagDef[]>('/api/tags'),
  update: (id: number, data: Partial<TagDef>) =>
    request<{ success: boolean }>(`/api/tags/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
};

// ── Events ────────────────────────────────────────────────────────────────────
export const eventsApi = {
  list: (limit = 50) => request<CrashEvent[]>(`/api/events?limit=${limit}`),
  acknowledgeAll: () =>
    request<{ success: boolean }>('/api/events/acknowledge-all', {
      method: 'POST',
    }),
};

// ── Sim ───────────────────────────────────────────────────────────────────────
export const simApi = {
  getTags: () =>
    request<Array<TagDef & { currentValue: boolean | number | null }>>(
      '/api/sim/tags',
    ),
  set: (logicalName: string, value: boolean | number) =>
    request<{ success: boolean }>('/api/sim/set', {
      method: 'POST',
      body: JSON.stringify({ logicalName, value }),
    }),
};
