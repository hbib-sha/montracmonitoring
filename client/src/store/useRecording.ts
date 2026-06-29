import { create } from 'zustand';
import { recordingApi } from '../lib/api';
import type {
  RecordingRun,
  RecordingSample,
  SegmentTiming,
  CrashMarker,
  RecordingStatusInfo,
} from '../../../server/src/types';

interface RunDetail {
  run: RecordingRun;
  samples: RecordingSample[];
  segments: SegmentTiming[];
  crashes: CrashMarker[];
  loading: boolean;
}

interface RecordingState {
  // Status of the active recording (synced via WebSocket in useLiveState,
  // but also fetchable directly here for the Reports page initial load)
  status: RecordingStatusInfo;
  runs: RecordingRun[];
  selectedRunDetail: RunDetail | null;
  loading: boolean;
  error: string | null;

  // Actions
  fetchStatus: () => Promise<void>;
  fetchRuns: () => Promise<void>;
  start: (name: string) => Promise<void>;
  stop: () => Promise<void>;
  selectRun: (id: number) => Promise<void>;
  clearSelection: () => void;
  markCrash: (runId: number, loopId: number, actualCrashAtMs?: number, note?: string) => Promise<void>;
  deleteRun: (id: number) => Promise<void>;
  clearAll: () => Promise<void>;
}

export const useRecording = create<RecordingState>((set, get) => ({
  status: { active: false, run: null },
  runs: [],
  selectedRunDetail: null,
  loading: false,
  error: null,

  fetchStatus: async () => {
    try {
      const status = await recordingApi.status();
      set({ status });
    } catch (err) {
      set({ error: String(err) });
    }
  },

  fetchRuns: async () => {
    set({ loading: true, error: null });
    try {
      const runs = await recordingApi.listRuns();
      set({ runs, loading: false });
    } catch (err) {
      set({ loading: false, error: String(err) });
    }
  },

  start: async (name: string) => {
    set({ error: null });
    try {
      const res = await recordingApi.start(name);
      set((s) => ({
        status: { active: true, run: res.run },
        runs: [res.run, ...s.runs],
      }));
    } catch (err) {
      set({ error: String(err) });
    }
  },

  stop: async () => {
    set({ error: null });
    try {
      const res = await recordingApi.stop();
      set((s) => ({
        status: { active: false, run: res.run },
        runs: s.runs.map((r) =>
          r.id === res.run?.id ? { ...r, ...res.run } : r,
        ),
      }));
    } catch (err) {
      set({ error: String(err) });
    }
  },

  selectRun: async (id: number) => {
    // Set loading state while keeping old detail visible
    set((s) => ({
      selectedRunDetail: s.selectedRunDetail
        ? { ...s.selectedRunDetail, loading: true }
        : { run: get().runs.find((r) => r.id === id)!, samples: [], segments: [], crashes: [], loading: true },
    }));
    try {
      const [run, samples, segments, crashes] = await Promise.all([
        recordingApi.getRun(id),
        recordingApi.getSamples(id),
        recordingApi.getSegments(id),
        recordingApi.getCrashes(id),
      ]);
      set({ selectedRunDetail: { run, samples, segments, crashes, loading: false } });
    } catch (err) {
      set({ error: String(err), selectedRunDetail: null });
    }
  },

  clearSelection: () => set({ selectedRunDetail: null }),

  markCrash: async (runId, loopId, actualCrashAtMs, note) => {
    set({ error: null });
    try {
      const res = await recordingApi.markCrash(runId, loopId, actualCrashAtMs, note);
      // Append to selected run detail if it's open
      set((s) => {
        if (s.selectedRunDetail?.run.id === runId) {
          return {
            selectedRunDetail: {
              ...s.selectedRunDetail,
              crashes: [...s.selectedRunDetail.crashes, res.marker],
            },
          };
        }
        return {};
      });
    } catch (err) {
      set({ error: String(err) });
    }
  },

  deleteRun: async (id: number) => {
    set({ error: null });
    try {
      await recordingApi.deleteRun(id);
      set((s) => ({
        runs: s.runs.filter((r) => r.id !== id),
        selectedRunDetail: s.selectedRunDetail?.run.id === id ? null : s.selectedRunDetail,
      }));
    } catch (err) {
      set({ error: String(err) });
    }
  },

  clearAll: async () => {
    set({ error: null });
    try {
      await recordingApi.clearAll();
      set({ runs: [], selectedRunDetail: null });
    } catch (err) {
      set({ error: String(err) });
    }
  },
}));
