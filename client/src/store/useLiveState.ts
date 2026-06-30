import { create } from 'zustand';
import { socket } from '../lib/socket';
import type { SystemState, AlarmInfo, RecordingStatusInfo, CalibrationStatusInfo } from '../../../server/src/types';

interface LiveState {
  system: SystemState | null;
  alarm: AlarmInfo;
  simTags: Record<string, boolean | number | string>;
  connected: boolean; // socket.io connection (not PLC)
  recordingStatus: RecordingStatusInfo;
  calibrationStatus: CalibrationStatusInfo;
}

const defaultCalibration: CalibrationStatusInfo = {
  active: false,
  loopId: null,
  targetRuns: 3,
  complete: false,
  segments: [],
};

const defaultAlarm: AlarmInfo = { state: 'idle' };

export const useLiveState = create<LiveState>(() => ({
  system: null,
  alarm: defaultAlarm,
  simTags: {},
  connected: false,
  recordingStatus: { active: false, run: null },
  calibrationStatus: defaultCalibration,
}));

// Wire socket events → store (runs once at module load)
socket.on('connect', () => {
  useLiveState.setState({ connected: true });
});
socket.on('disconnect', () => {
  useLiveState.setState({ connected: false });
});
socket.on('systemState', (state) => {
  useLiveState.setState({ system: state, alarm: state.alarm });
});
socket.on('alarmUpdate', (info) => {
  useLiveState.setState({ alarm: info });
});
socket.on('simTags', (tags) => {
  useLiveState.setState({ simTags: tags });
});
socket.on('recordingStatus', (info) => {
  useLiveState.setState({ recordingStatus: info });
});
socket.on('calibrationStatus', (info) => {
  useLiveState.setState({ calibrationStatus: info });
});
