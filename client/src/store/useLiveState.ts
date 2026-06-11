import { create } from 'zustand';
import { socket } from '../lib/socket';
import type { SystemState, AlarmInfo } from '../../../server/src/types';

interface LiveState {
  system: SystemState | null;
  alarm: AlarmInfo;
  simTags: Record<string, boolean | number | string>;
  connected: boolean; // socket.io connection (not PLC)
}

const defaultAlarm: AlarmInfo = { state: 'idle' };

export const useLiveState = create<LiveState>(() => ({
  system: null,
  alarm: defaultAlarm,
  simTags: {},
  connected: false,
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
