import { create } from 'zustand';
import { calibrationApi } from '../lib/api';
import type { CalibrationProposalRow } from '../../../server/src/types';

/**
 * Calibration store — owns the proposal/apply lifecycle and async flags.
 * Live session progress (active, segments, complete) arrives over the socket
 * and lives in useLiveState.calibrationStatus.
 */
interface CalibrationState {
  proposal: CalibrationProposalRow[] | null;
  loadingProposal: boolean;
  applying: boolean;
  error: string | null;

  start: (loopId: number) => Promise<void>;
  stop: () => Promise<void>;
  fetchProposal: (loopId: number) => Promise<void>;
  apply: (loopId: number, distances?: Record<number, number>) => Promise<boolean>;
  clear: () => void;
}

export const useCalibration = create<CalibrationState>((set) => ({
  proposal: null,
  loadingProposal: false,
  applying: false,
  error: null,

  start: async (loopId) => {
    set({ error: null, proposal: null });
    try {
      await calibrationApi.start(loopId);
    } catch (err) {
      set({ error: String(err) });
    }
  },

  stop: async () => {
    set({ error: null });
    try {
      await calibrationApi.stop();
    } catch (err) {
      set({ error: String(err) });
    }
  },

  fetchProposal: async (loopId) => {
    set({ loadingProposal: true, error: null });
    try {
      const proposal = await calibrationApi.propose(loopId);
      set({ proposal, loadingProposal: false });
    } catch (err) {
      set({ loadingProposal: false, error: String(err) });
    }
  },

  apply: async (loopId, distances) => {
    set({ applying: true, error: null });
    try {
      await calibrationApi.apply(loopId, distances);
      set({ applying: false, proposal: null });
      return true;
    } catch (err) {
      set({ applying: false, error: String(err) });
      return false;
    }
  },

  clear: () => set({ proposal: null, error: null }),
}));
