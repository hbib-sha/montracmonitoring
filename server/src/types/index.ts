// ─── Domain types shared across server modules ────────────────────────────────

export type PlcMode = 'real' | 'simulation';
export type CheckpointType = 'IRM_ID' | 'IRM' | 'SENSOR';
export type ShuttleStatus = 'stopped' | 'moving' | 'crashed';
export type TagDirection = 'read' | 'write' | 'readwrite';
export type TagDataType = 'Boolean' | 'Int32' | 'Float' | 'String';
export type AlarmState = 'idle' | 'active' | 'acknowledged';

export interface TagDef {
  id: number;
  logicalName: string;
  nodeId: string;        // e.g. "ns=7;s=S71500ET200MP station_1.Conveyor_ctrl.IR3_AR_DET"
  dataType: TagDataType;
  direction: TagDirection;
  description: string;
}

export interface CheckpointDef {
  id: number;
  loopId: number;
  sequence: number;       // 0-based order in loop
  name: string;
  type: CheckpointType;
  distanceMmToNext: number; // physical distance to next checkpoint
  bufferMs: number;         // buffer time on top of ETA for crash detection
  detTagId?: number;        // IRM / IRM_ID: detect input tag id
  idTagId?: number;         // IRM_ID only: shuttle ID input tag id
  goTagId?: number;         // IRM / IRM_ID: go output tag id
  signoffTagId?: number;    // SENSOR: signoff input tag id
}

export interface LoopDef {
  id: number;
  name: string;
  description: string;
  checkpoints: CheckpointDef[];
  /** Shuttle IDs tracked by this loop. Any ID not in this list is ignored at IRM_ID checkpoints. Empty = track all. */
  allowedShuttleIds: number[];
}

export interface VirtualShuttleState {
  id: number;              // shuttle ID (from RS232 or sequence-assigned)
  loopId: number;
  checkpointIndex: number; // index in the loop's checkpoint array
  status: ShuttleStatus;
  stoppedAtName?: string;
  movedAtMs?: number;      // timestamp when GO was sent (epoch ms)
  etaMs?: number;          // travel time in ms for next segment
}

export interface CheckpointState {
  id: number;
  name: string;
  type: CheckpointType;
  detecting: boolean;
  detectedShuttleId?: number;
  goSignalActive: boolean;
}

export interface SegmentCrash {
  fromIndex: number;  // checkpoint index the shuttle departed from
  toIndex: number;    // checkpoint index it was heading to
}

export interface LoopState {
  id: number;
  name: string;
  checkpoints: CheckpointState[];
  shuttles: VirtualShuttleState[];
  crashedSegments: SegmentCrash[];
}

export interface AlarmInfo {
  state: AlarmState;
  loopId?: number;
  segmentFrom?: number;
  segmentTo?: number;
  startedAtMs?: number;
  autoOffAtMs?: number;
}

export interface SystemState {
  mode: PlcMode;
  connected: boolean;
  tagCheckResults: Record<string, boolean>; // logicalName → readable
  loops: LoopState[];
  alarm: AlarmInfo;
}

export interface Settings {
  opcEndpoint: string;
  mode: PlcMode;
  alarmAutoOffMs: number;
  avgSpeedMmPerSec: number;
  lightTowerNodeId: string;
  buzzerNodeId: string;
  pushButton1NodeId: string;
}

export interface CrashEvent {
  id: number;
  loopId: number;
  loopName: string;
  segmentFrom: number;  // checkpoint sequence number
  segmentTo: number;
  createdAt: string;    // ISO timestamp
  resolvedAt?: string;
  acknowledged: boolean;
  runId?: number;
}

// ─── Recording types ──────────────────────────────────────────────────────────

export type RecordingStatus = 'recording' | 'stopped';

export interface RecordingRun {
  id: number;
  name: string;
  startedAt: string;      // ISO timestamp
  endedAt?: string;
  status: RecordingStatus;
  mode: PlcMode;
  sampleIntervalMs: number;
  notes: string;
  sampleCount?: number;   // aggregate (populated by getRun)
  segmentCount?: number;
  crashMarkerCount?: number;
}

export interface RecordingSample {
  id: number;
  runId: number;
  t: number;              // epoch ms
  connected: boolean;
  mode: PlcMode;
  activeShuttleCount: number;
  crashedCount: number;
  snapshotJson: string;   // JSON-serialised SystemState
}

export interface SegmentTiming {
  id: number;
  runId: number;
  loopId: number;
  shuttleId: number;
  fromIndex: number;
  toIndex: number;
  predictedEtaMs: number;
  actualElapsedMs: number;
  recordedAt: string;
}

export interface CrashMarker {
  id: number;
  runId: number;
  loopId: number;
  actualCrashAtMs: number;
  detectedEventId?: number;
  detectedAtMs?: number;
  detectionLatencyMs?: number;
  note: string;
  createdAt: string;
}

export interface RecordingStatusInfo {
  active: boolean;
  run: RecordingRun | null;
}

export interface ShuttleAdvancedPayload {
  loopId: number;
  shuttleId: number;
  fromIndex: number;
  toIndex: number;
  predictedEtaMs: number;
  actualElapsedMs: number;
}

/**
 * Emitted when an arrival clears a previously-crashed segment — i.e. a delayed
 * shuttle recovered. `remainingCrashes` is how many crashed segments are still
 * left in that loop after this one cleared (0 = loop fully recovered).
 */
export interface SegmentRecoveredPayload {
  loopId: number;
  fromIndex: number;
  toIndex: number;
  remainingCrashes: number;
}

// ─── Calibration types ──────────────────────────────────────────────────────────

/** Live progress of one segment during a calibration session. */
export interface CalibrationSegmentStatus {
  fromIndex: number;       // checkpoint index the segment departs from
  toIndex: number;         // checkpoint index it arrives at
  cpId: number;            // id of the departing checkpoint (owns distanceMmToNext)
  cpName: string;
  count: number;           // samples collected so far (0..targetRuns)
  avgMs: number | null;    // running average travel time, null until first sample
}

/** Status of the calibration session — broadcast over the socket. */
export interface CalibrationStatusInfo {
  active: boolean;
  loopId: number | null;
  targetRuns: number;      // laps required per segment (3)
  complete: boolean;       // every segment has targetRuns samples
  segments: CalibrationSegmentStatus[];
}

/** One row of the before/after proposal shown for review. */
export interface CalibrationProposalRow {
  cpId: number;
  cpName: string;
  fromIndex: number;
  currentDistanceMm: number;
  proposedDistanceMm: number;
  avgMs: number;
  sampleCount: number;
}

// ─── WebSocket event payloads (also imported by client) ───────────────────────
export interface WsServerToClientEvents {
  systemState: (state: SystemState) => void;
  tagCheckResult: (results: Record<string, boolean>) => void;
  alarm: (info: AlarmInfo) => void;
}

export interface WsClientToServerEvents {
  arenaOverride: (payload: {
    loopId: number;
    direction: 'left' | 'straight' | 'right';
  }) => void;
  acknowledgeAlarm: () => void;
  sendGo: (payload: { checkpointId: number }) => void;
  simSetTag: (payload: { logicalName: string; value: boolean | number }) => void;
}
