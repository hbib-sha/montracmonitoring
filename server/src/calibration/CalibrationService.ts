/**
 * CalibrationService — auto-calibrates checkpoint distances from real runs.
 *
 * Flow (per loop):
 *  1. start(loopId): begin collecting. One shuttle makes `targetRuns` (3) laps.
 *  2. Each shuttle transit emits `shuttleAdvanced` (fromIndex, actualElapsedMs);
 *     we average the elapsed time per segment until every segment has 3 samples.
 *  3. propose(loopId): back-solve distance = avgMs × avgSpeed / 1000 so the
 *     engine's ETA formula (Loop.etaMs) reproduces the measured travel time.
 *  4. apply(loopId): write distance + a 3 s crash buffer to every checkpoint,
 *     then reload the engine so the new config takes effect live.
 *
 * The service is mode-agnostic — it only reacts to engine events. The UI gates
 * the control to real mode.
 */
import { EventEmitter } from 'events';
import pino from 'pino';
import type { MonitoringEngine } from '../monitoring/MonitoringEngine';
import { checkpointRepo } from '../db/repositories/checkpointRepo';
import type {
  CalibrationStatusInfo,
  CalibrationProposalRow,
  ShuttleAdvancedPayload,
} from '../types';

const logger = pino({ name: 'CalibrationService' });

/** Crash buffer applied to calibrated checkpoints: ±3 seconds. */
export const CALIBRATION_BUFFER_MS = 3000;

export declare interface CalibrationService {
  on(event: 'statusChanged', listener: () => void): this;
}

export class CalibrationService extends EventEmitter {
  private active = false;
  private loopId: number | null = null;
  private complete = false;
  private readonly targetRuns = 3;
  /** fromIndex → collected elapsed-time samples (capped at targetRuns). */
  private samples = new Map<number, number[]>();

  constructor(
    private engine: MonitoringEngine,
    private getAvgSpeed: () => number,
  ) {
    super();
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /** Begin a calibration session for one loop. Throws if the loop is unknown. */
  start(loopId: number): CalibrationStatusInfo {
    const loop = this.engine.getLoopById(loopId);
    if (!loop) throw new Error(`Loop ${loopId} not found`);

    this.active   = true;
    this.complete = false;
    this.loopId   = loopId;
    this.samples  = new Map();
    logger.info({ loopId, targetRuns: this.targetRuns }, 'Calibration started');
    this.emit('statusChanged');
    return this.getStatus();
  }

  /** Stop collecting but keep the samples so the proposal stays available. */
  stop(): CalibrationStatusInfo {
    if (this.active) logger.info({ loopId: this.loopId }, 'Calibration stopped');
    this.active = false;
    this.emit('statusChanged');
    return this.getStatus();
  }

  /** Called by the gateway on every shuttle transit. */
  onShuttleAdvanced(payload: ShuttleAdvancedPayload): void {
    if (!this.active || payload.loopId !== this.loopId) return;

    const arr = this.samples.get(payload.fromIndex) ?? [];
    if (arr.length >= this.targetRuns) return; // already have enough for this segment
    arr.push(payload.actualElapsedMs);
    this.samples.set(payload.fromIndex, arr);

    const loop = this.engine.getLoopById(payload.loopId);
    if (loop && this.allSegmentsComplete(loop.checkpoints.length)) {
      this.complete = true;
      logger.info({ loopId: this.loopId }, 'Calibration complete — all segments sampled');
    }
    this.emit('statusChanged');
  }

  getStatus(): CalibrationStatusInfo {
    const base: CalibrationStatusInfo = {
      active:     this.active,
      loopId:     this.loopId,
      targetRuns: this.targetRuns,
      complete:   this.complete,
      segments:   [],
    };
    if (this.loopId === null) return base;

    const loop = this.engine.getLoopById(this.loopId);
    if (!loop) return base;

    const n = loop.checkpoints.length;
    base.segments = loop.checkpoints.map((cp, fromIndex) => {
      const arr = this.samples.get(fromIndex) ?? [];
      return {
        fromIndex,
        toIndex: (fromIndex + 1) % n,
        cpId:    cp.id,
        cpName:  cp.name,
        count:   arr.length,
        avgMs:   arr.length > 0 ? mean(arr) : null,
      };
    });
    return base;
  }

  /** Compute the before/after distance proposal for the current samples. */
  propose(loopId: number): CalibrationProposalRow[] {
    const loop = this.engine.getLoopById(loopId);
    if (!loop) throw new Error(`Loop ${loopId} not found`);
    const avgSpeed = this.getAvgSpeed();

    const rows: CalibrationProposalRow[] = [];
    loop.checkpoints.forEach((cp, fromIndex) => {
      const arr = this.samples.get(fromIndex);
      if (!arr || arr.length === 0) return;
      const avgMs = mean(arr);
      rows.push({
        cpId:               cp.id,
        cpName:             cp.name,
        fromIndex,
        currentDistanceMm:  cp.distanceMmToNext,
        proposedDistanceMm: Math.round((avgMs * avgSpeed) / 1000),
        avgMs,
        sampleCount:        arr.length,
      });
    });
    return rows;
  }

  /**
   * Persist the proposed distances (with optional per-checkpoint overrides) and
   * a 3 s crash buffer, then reload the engine so changes take effect live.
   * `distances` maps checkpoint id → distance in mm.
   */
  apply(loopId: number, distances?: Record<number, number>): CalibrationProposalRow[] {
    const rows = this.propose(loopId);
    if (rows.length === 0) throw new Error('No calibration samples to apply');

    for (const row of rows) {
      const distanceMm = distances?.[row.cpId] ?? row.proposedDistanceMm;
      checkpointRepo.updateDistanceAndBuffer(row.cpId, distanceMm, CALIBRATION_BUFFER_MS);
    }

    // Reload so the running engine adopts the new distances/buffer.
    this.engine.reload(this.getAvgSpeed());
    logger.info({ loopId, count: rows.length }, 'Calibration applied — engine reloaded');

    // Session is consumed; reset so a fresh calibration can start.
    this.active   = false;
    this.complete = false;
    this.loopId   = null;
    this.samples  = new Map();
    this.emit('statusChanged');
    return rows;
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private allSegmentsComplete(checkpointCount: number): boolean {
    for (let i = 0; i < checkpointCount; i++) {
      if ((this.samples.get(i)?.length ?? 0) < this.targetRuns) return false;
    }
    return checkpointCount > 0;
  }
}

function mean(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}
