/** Typed fetch helpers for REST API routes. */
import type {
  Settings,
  TagDef,
  CrashEvent,
  RecordingRun,
  RecordingSample,
  SegmentTiming,
  CrashMarker,
  RecordingStatusInfo,
  CalibrationStatusInfo,
  CalibrationProposalRow,
} from '../../../server/src/types';

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

// ── Recording ─────────────────────────────────────────────────────────────────
export const recordingApi = {
  status: () =>
    request<RecordingStatusInfo>('/api/recording/status'),
  start: (name: string) =>
    request<{ success: boolean; run: RecordingRun }>('/api/recording/start', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),
  stop: () =>
    request<{ success: boolean; run: RecordingRun | null }>('/api/recording/stop', {
      method: 'POST',
    }),
  listRuns: () =>
    request<RecordingRun[]>('/api/recording/runs'),
  getRun: (id: number) =>
    request<RecordingRun>(`/api/recording/runs/${id}`),
  getSamples: (id: number) =>
    request<RecordingSample[]>(`/api/recording/runs/${id}/samples`),
  getSegments: (id: number) =>
    request<SegmentTiming[]>(`/api/recording/runs/${id}/segments`),
  getCrashes: (id: number) =>
    request<CrashMarker[]>(`/api/recording/runs/${id}/crashes`),
  markCrash: (id: number, loopId: number, actualCrashAtMs?: number, note?: string) =>
    request<{ success: boolean; marker: CrashMarker }>(
      `/api/recording/runs/${id}/crash-marker`,
      { method: 'POST', body: JSON.stringify({ loopId, actualCrashAtMs, note }) },
    ),
  deleteRun: (id: number) =>
    request<{ success: boolean }>(`/api/recording/runs/${id}`, { method: 'DELETE' }),
  clearAll: () =>
    request<{ success: boolean }>('/api/recording/runs', { method: 'DELETE' }),
  exportUrl: (id: number, format: 'csv' | 'json') =>
    `/api/recording/runs/${id}/export?format=${format}`,
};

// ── Calibration ───────────────────────────────────────────────────────────────
export const calibrationApi = {
  status: () =>
    request<CalibrationStatusInfo>('/api/calibration/status'),
  start: (loopId: number) =>
    request<{ success: boolean; status: CalibrationStatusInfo }>('/api/calibration/start', {
      method: 'POST',
      body: JSON.stringify({ loopId }),
    }),
  stop: () =>
    request<{ success: boolean; status: CalibrationStatusInfo }>('/api/calibration/stop', {
      method: 'POST',
    }),
  propose: (loopId: number) =>
    request<CalibrationProposalRow[]>(`/api/calibration/propose?loopId=${loopId}`),
  apply: (loopId: number, distances?: Record<number, number>) =>
    request<{ success: boolean; applied: CalibrationProposalRow[] }>('/api/calibration/apply', {
      method: 'POST',
      body: JSON.stringify({ loopId, distances }),
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
