import { db } from '../index';
import type {
  RecordingRun,
  RecordingSample,
  SegmentTiming,
  CrashMarker,
  PlcMode,
} from '../../types';

// ── Row types ──────────────────────────────────────────────────────────────────

type RunRow = {
  id: number;
  name: string;
  started_at: string;
  ended_at: string | null;
  status: string;
  mode: string;
  sample_interval_ms: number;
  notes: string;
  sample_count?: number;
  segment_count?: number;
  crash_marker_count?: number;
};

type SampleRow = {
  id: number;
  run_id: number;
  t: number;
  connected: number;
  mode: string;
  active_shuttle_count: number;
  crashed_count: number;
  snapshot_json: string;
};

type TimingRow = {
  id: number;
  run_id: number;
  loop_id: number;
  shuttle_id: number;
  from_index: number;
  to_index: number;
  predicted_eta_ms: number;
  actual_elapsed_ms: number;
  recorded_at: string;
};

type MarkerRow = {
  id: number;
  run_id: number;
  loop_id: number;
  actual_crash_at_ms: number;
  detected_event_id: number | null;
  detected_at_ms: number | null;
  detection_latency_ms: number | null;
  note: string;
  created_at: string;
};

// ── Mappers ───────────────────────────────────────────────────────────────────

function mapRun(r: RunRow): RecordingRun {
  return {
    id:               r.id,
    name:             r.name,
    startedAt:        r.started_at,
    endedAt:          r.ended_at ?? undefined,
    status:           r.status as RecordingRun['status'],
    mode:             r.mode as PlcMode,
    sampleIntervalMs: r.sample_interval_ms,
    notes:            r.notes,
    sampleCount:      r.sample_count,
    segmentCount:     r.segment_count,
    crashMarkerCount: r.crash_marker_count,
  };
}

function mapSample(r: SampleRow): RecordingSample {
  return {
    id:                 r.id,
    runId:              r.run_id,
    t:                  r.t,
    connected:          r.connected === 1,
    mode:               r.mode as PlcMode,
    activeShuttleCount: r.active_shuttle_count,
    crashedCount:       r.crashed_count,
    snapshotJson:       r.snapshot_json,
  };
}

function mapTiming(r: TimingRow): SegmentTiming {
  return {
    id:               r.id,
    runId:            r.run_id,
    loopId:           r.loop_id,
    shuttleId:        r.shuttle_id,
    fromIndex:        r.from_index,
    toIndex:          r.to_index,
    predictedEtaMs:   r.predicted_eta_ms,
    actualElapsedMs:  r.actual_elapsed_ms,
    recordedAt:       r.recorded_at,
  };
}

function mapMarker(r: MarkerRow): CrashMarker {
  return {
    id:                  r.id,
    runId:               r.run_id,
    loopId:              r.loop_id,
    actualCrashAtMs:     r.actual_crash_at_ms,
    detectedEventId:     r.detected_event_id ?? undefined,
    detectedAtMs:        r.detected_at_ms ?? undefined,
    detectionLatencyMs:  r.detection_latency_ms ?? undefined,
    note:                r.note,
    createdAt:           r.created_at,
  };
}

// ── Repository ────────────────────────────────────────────────────────────────

export const recordingRepo = {
  // ── Runs ───────────────────────────────────────────────────────────────────

  createRun(name: string, mode: PlcMode, sampleIntervalMs = 1000): RecordingRun {
    const result = db.prepare(
      `INSERT INTO recording_runs (name, mode, sample_interval_ms, status)
       VALUES (?, ?, ?, 'recording')`,
    ).run(name, mode, sampleIntervalMs);
    return mapRun(
      db.prepare('SELECT * FROM recording_runs WHERE id = ?')
        .get(result.lastInsertRowid as number) as RunRow,
    );
  },

  endRun(id: number): void {
    db.prepare(
      `UPDATE recording_runs
       SET status='stopped', ended_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
       WHERE id=?`,
    ).run(id);
  },

  getActiveRun(): RecordingRun | null {
    const row = db.prepare(
      "SELECT * FROM recording_runs WHERE status='recording' ORDER BY id DESC LIMIT 1",
    ).get() as RunRow | undefined;
    return row ? mapRun(row) : null;
  },

  listRuns(): RecordingRun[] {
    const rows = db.prepare(
      `SELECT r.*,
         (SELECT COUNT(*) FROM recording_samples  s WHERE s.run_id=r.id) AS sample_count,
         (SELECT COUNT(*) FROM segment_timings    t WHERE t.run_id=r.id) AS segment_count,
         (SELECT COUNT(*) FROM crash_markers      m WHERE m.run_id=r.id) AS crash_marker_count
       FROM recording_runs r
       ORDER BY r.id DESC`,
    ).all() as RunRow[];
    return rows.map(mapRun);
  },

  getRun(id: number): RecordingRun | null {
    const row = db.prepare(
      `SELECT r.*,
         (SELECT COUNT(*) FROM recording_samples  s WHERE s.run_id=r.id) AS sample_count,
         (SELECT COUNT(*) FROM segment_timings    t WHERE t.run_id=r.id) AS segment_count,
         (SELECT COUNT(*) FROM crash_markers      m WHERE m.run_id=r.id) AS crash_marker_count
       FROM recording_runs r WHERE r.id=?`,
    ).get(id) as RunRow | undefined;
    return row ? mapRun(row) : null;
  },

  deleteRun(id: number): void {
    // CASCADE delete handles samples, segment_timings, crash_markers
    db.prepare('DELETE FROM recording_runs WHERE id=?').run(id);
  },

  clearAll(): void {
    db.exec('DELETE FROM recording_runs');
    // Orphaned rows cleaned by CASCADE
  },

  // ── Samples ────────────────────────────────────────────────────────────────

  insertSample(
    runId: number,
    t: number,
    connected: boolean,
    mode: PlcMode,
    activeShuttleCount: number,
    crashedCount: number,
    snapshotJson: string,
  ): void {
    db.prepare(
      `INSERT INTO recording_samples
         (run_id, t, connected, mode, active_shuttle_count, crashed_count, snapshot_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(runId, t, connected ? 1 : 0, mode, activeShuttleCount, crashedCount, snapshotJson);
  },

  getSamples(runId: number): RecordingSample[] {
    const rows = db.prepare(
      'SELECT * FROM recording_samples WHERE run_id=? ORDER BY t ASC',
    ).all(runId) as SampleRow[];
    return rows.map(mapSample);
  },

  // ── Segment timings ────────────────────────────────────────────────────────

  insertSegmentTiming(
    runId: number,
    loopId: number,
    shuttleId: number,
    fromIndex: number,
    toIndex: number,
    predictedEtaMs: number,
    actualElapsedMs: number,
  ): void {
    db.prepare(
      `INSERT INTO segment_timings
         (run_id, loop_id, shuttle_id, from_index, to_index, predicted_eta_ms, actual_elapsed_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(runId, loopId, shuttleId, fromIndex, toIndex, predictedEtaMs, actualElapsedMs);
  },

  getSegmentTimings(runId: number): SegmentTiming[] {
    const rows = db.prepare(
      'SELECT * FROM segment_timings WHERE run_id=? ORDER BY recorded_at ASC',
    ).all(runId) as TimingRow[];
    return rows.map(mapTiming);
  },

  // ── Crash markers ──────────────────────────────────────────────────────────

  createCrashMarker(
    runId: number,
    loopId: number,
    actualCrashAtMs: number,
    note = '',
  ): CrashMarker {
    const result = db.prepare(
      `INSERT INTO crash_markers (run_id, loop_id, actual_crash_at_ms, note)
       VALUES (?, ?, ?, ?)`,
    ).run(runId, loopId, actualCrashAtMs, note);
    return mapMarker(
      db.prepare('SELECT * FROM crash_markers WHERE id=?')
        .get(result.lastInsertRowid as number) as MarkerRow,
    );
  },

  /**
   * Pair the most recent open marker (no detected_event_id) for the given
   * run + loop with a detected crash event, computing detection latency.
   */
  pairOpenCrashMarker(
    runId: number,
    loopId: number,
    eventId: number,
    detectedAtMs: number,
  ): void {
    const marker = db.prepare(
      `SELECT * FROM crash_markers
       WHERE run_id=? AND loop_id=? AND detected_event_id IS NULL
       ORDER BY created_at DESC LIMIT 1`,
    ).get(runId, loopId) as MarkerRow | undefined;

    if (!marker) return; // no open marker to pair

    const latency = detectedAtMs - marker.actual_crash_at_ms;
    db.prepare(
      `UPDATE crash_markers
       SET detected_event_id=?, detected_at_ms=?, detection_latency_ms=?
       WHERE id=?`,
    ).run(eventId, detectedAtMs, latency, marker.id);
  },

  getCrashMarkers(runId: number): CrashMarker[] {
    const rows = db.prepare(
      'SELECT * FROM crash_markers WHERE run_id=? ORDER BY created_at ASC',
    ).all(runId) as MarkerRow[];
    return rows.map(mapMarker);
  },
};
