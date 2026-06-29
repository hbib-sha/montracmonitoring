/**
 * Typed Socket.IO event names and payload contracts.
 * Imported by both server (gateway.ts) and client (socket.ts).
 */
import type { SystemState, AlarmInfo, RecordingStatusInfo } from '../types';

// Server → Client
export interface ServerToClientEvents {
  /** Full system state snapshot (sent on connect + on every state change). */
  systemState: (state: SystemState) => void;
  /** Alarm state update. */
  alarmUpdate: (info: AlarmInfo) => void;
  /** Simulated tag values map (sim mode only). */
  simTags: (tags: Record<string, boolean | number | string>) => void;
  /** Recording run status — sent when recording starts or stops. */
  recordingStatus: (info: RecordingStatusInfo) => void;
}

// Client → Server
export interface ClientToServerEvents {
  /** Arena direction override. */
  arenaOverride: (payload: {
    loopId: number;
    direction: 'left' | 'straight' | 'right';
    lu_node_id: string;
    st_node_id: string;
    ru_node_id: string;
  }) => void;
  /** Acknowledge the active alarm. */
  acknowledgeAlarm: () => void;
  /** Send GO signal to an IRM checkpoint. */
  sendGo: (payload: { checkpointId: number }) => void;
  /** Simulation mode: manually set a tag value by logical name. */
  simSetTag: (payload: { logicalName: string; value: boolean | number }) => void;
  /** Reset a loop — despawns all virtual shuttles and clears crash state. */
  stopLoop: (payload: { loopId: number }) => void;
}

// Inter-server data
export interface InterServerEvents {
  ping: () => void;
}

// Per-socket data
export interface SocketData {
  username?: string;
}
