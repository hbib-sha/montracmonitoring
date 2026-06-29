/**
 * RecordingService — manages recording runs and persists system data to SQLite.
 *
 * A "run" is a named recording session. When active, the service:
 *  - Samples the full SystemState every `sampleIntervalMs` (default 1 s)
 *  - Records per-segment ETA timings on `shuttleAdvanced` engine events
 *  - Pairs user-supplied "actual crash" markers with detected crash events
 *    to compute crash-detection latency
 */
import pino from 'pino';
import type { MonitoringEngine } from '../monitoring/MonitoringEngine';
import { recordingRepo } from '../db/repositories/recordingRepo';
import type {
  RecordingRun,
  RecordingStatusInfo,
  SystemState,
  ShuttleAdvancedPayload,
  CrashMarker,
} from '../types';

const logger = pino({ name: 'RecordingService' });

export class RecordingService {
  private activeRunId: number | null = null;
  private samplerTimer: ReturnType<typeof setInterval> | null = null;
  private readonly sampleIntervalMs: number;

  constructor(
    private engine: MonitoringEngine,
    private buildSystemState: () => SystemState,
    sampleIntervalMs = 1000,
  ) {
    this.sampleIntervalMs = sampleIntervalMs;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  start(name: string): RecordingRun {
    if (this.activeRunId !== null) {
      // Stop previous run first
      this.stop();
    }

    const state = this.buildSystemState();
    const run = recordingRepo.createRun(name, state.mode, this.sampleIntervalMs);
    this.activeRunId = run.id;

    // Start periodic sampler
    this.samplerTimer = setInterval(() => {
      this.takeSample();
    }, this.sampleIntervalMs);

    // Take an immediate first sample
    this.takeSample();

    logger.info({ runId: run.id, name }, 'Recording started');
    return run;
  }

  stop(): RecordingRun | null {
    if (this.activeRunId === null) return null;

    if (this.samplerTimer) {
      clearInterval(this.samplerTimer);
      this.samplerTimer = null;
    }

    recordingRepo.endRun(this.activeRunId);
    const run = recordingRepo.getRun(this.activeRunId);
    logger.info({ runId: this.activeRunId }, 'Recording stopped');
    this.activeRunId = null;
    return run;
  }

  getStatus(): RecordingStatusInfo {
    if (this.activeRunId === null) {
      return { active: false, run: null };
    }
    const run = recordingRepo.getRun(this.activeRunId);
    return { active: run !== null, run };
  }

  /** Called by the gateway when a shuttle advances to a new checkpoint. */
  onShuttleAdvanced(payload: ShuttleAdvancedPayload): void {
    if (this.activeRunId === null) return;
    recordingRepo.insertSegmentTiming(
      this.activeRunId,
      payload.loopId,
      payload.shuttleId,
      payload.fromIndex,
      payload.toIndex,
      payload.predictedEtaMs,
      payload.actualElapsedMs,
    );
  }

  /** Called by the gateway when the engine emits a crash. */
  onCrashDetected(loopId: number, eventId: number): void {
    if (this.activeRunId === null) return;
    recordingRepo.pairOpenCrashMarker(this.activeRunId, loopId, eventId, Date.now());
  }

  /**
   * Record the user-supplied "actual" crash time for a loop.
   * Later paired with the detected crash event when onCrashDetected fires.
   */
  markActualCrash(loopId: number, actualCrashAtMs: number, note = ''): CrashMarker | null {
    if (this.activeRunId === null) return null;
    return recordingRepo.createCrashMarker(this.activeRunId, loopId, actualCrashAtMs, note);
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private takeSample(): void {
    if (this.activeRunId === null) return;
    try {
      const state = this.buildSystemState();
      const now   = Date.now();

      // Aggregate counts across all loops
      let activeShuttleCount = 0;
      let crashedCount       = 0;
      for (const loop of state.loops) {
        for (const shuttle of loop.shuttles) {
          if (shuttle.status === 'moving' || shuttle.status === 'stopped') {
            activeShuttleCount++;
          }
          if (shuttle.status === 'crashed') crashedCount++;
        }
      }

      recordingRepo.insertSample(
        this.activeRunId,
        now,
        state.connected,
        state.mode,
        activeShuttleCount,
        crashedCount,
        JSON.stringify(state),
      );
    } catch (err) {
      logger.warn({ err }, 'Failed to take recording sample');
    }
  }
}
