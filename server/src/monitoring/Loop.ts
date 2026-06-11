/**
 * Loop — manages checkpoints and virtual shuttles for one loop.
 * Called by MonitoringEngine each poll tick with a fresh tag snapshot.
 *
 * Key changes vs original:
 *  - tick() reads Checkpoint.arrivalEdge and Checkpoint.goEdge (set by
 *    the new order-independent armed model in Checkpoint.ts).
 *  - handleGo() is called on the GO rising edge instead of from an external
 *    sendGo() operator command. The engine still exposes sendGo() which now
 *    only writes a GO pulse; the Loop reacts when it reads that pulse back.
 *  - clearCrashes() fully resets crashed shuttles (status + stale ETA fields)
 *    so they don't remain stuck as "moving".
 */
import { EventEmitter } from 'events';
import type { LoopDef, LoopState, SegmentCrash } from '../types';
import { Checkpoint } from './Checkpoint';
import { VirtualShuttle } from './VirtualShuttle';
import { CrashDetector, type CrashPayload } from './crashDetection';

export interface ShuttleUpdatePayload {
  loopId: number;
}

export declare interface Loop {
  on(event: 'crash', listener: (payload: CrashPayload) => void): this;
  on(event: 'shuttleUpdate', listener: (payload: ShuttleUpdatePayload) => void): this;
}

export class Loop extends EventEmitter {
  public readonly checkpoints: Checkpoint[];
  private shuttles = new Map<number, VirtualShuttle>(); // shuttleId → shuttle
  private crashedSegments: SegmentCrash[] = [];
  private crashDetector = new CrashDetector();
  // For IRM (no ID) checkpoints: queue of shuttles we expect to arrive next
  private movingShuttleQueue: VirtualShuttle[] = [];

  constructor(public readonly def: LoopDef, private avgSpeedMmPerSec: number) {
    super();
    this.checkpoints = def.checkpoints
      .sort((a, b) => a.sequence - b.sequence)
      .map((cp) => new Checkpoint(cp));

    this.crashDetector.on('crash', (payload) => {
      this.markCrash(payload.fromIndex, payload.toIndex);
      this.emit('crash', payload);
    });
  }

  get id(): number   { return this.def.id; }
  get name(): string { return this.def.name; }

  /** Update average speed (called when settings change). */
  setAvgSpeed(mmPerSec: number): void {
    this.avgSpeedMmPerSec = mmPerSec;
  }

  /**
   * Main tick — called with a snapshot of all tag values.
   * Delegates to Checkpoint for state computation, then handles
   * arrival and GO edges via the appropriate handlers.
   */
  tick(snapshot: Record<string, boolean | number | string>): void {
    this.checkpoints.forEach((cp, idx) => {
      cp.updateFromSnapshot(snapshot);
      if (cp.arrivalEdge) this.handleArrival(cp, idx);
      if (cp.goEdge)      this.handleGo(idx);
    });
  }

  /** All input node IDs needed by this loop (including GO tags). */
  get allInputNodeIds(): string[] {
    return this.checkpoints.flatMap((cp) => cp.inputNodeIds);
  }

  /**
   * Clear crash state after alarm acknowledge (or push-button).
   *
   * Rather than freezing the shuttle as stopped, we keep it moving and give
   * it one more buffer-period from now so it can still arrive normally.
   * If it doesn't arrive within that window, a new crash fires.
   */
  clearCrashes(): void {
    this.crashedSegments = [];
    this.crashDetector.clearLoop(this.id); // cancel expired timers first

    for (const shuttle of this.shuttles.values()) {
      if (shuttle.status !== 'crashed') continue;

      const fromIdx = shuttle.checkpointIndex;
      const toIdx   = this.nextIndex(fromIdx);
      const nextCp  = this.checkpoints[toIdx];

      // Resume moving; give the shuttle exactly one buffer-period from now
      shuttle.status    = 'moving';
      shuttle.movedAtMs = Date.now();
      shuttle.etaMs     = nextCp.bufferMs;

      // Restart crash detection: ETA=0 so the timer is just bufferMs from now
      this.crashDetector.startTracking(
        this.id, fromIdx, toIdx, shuttle.id, 0, nextCp.bufferMs,
      );

      // Ensure the shuttle is in the moving queue for IRM-type next checkpoints
      // (it may not be there if it originally departed from an IRM_ID checkpoint)
      if (!this.movingShuttleQueue.some((s) => s.id === shuttle.id)) {
        this.movingShuttleQueue.push(shuttle);
      }
    }

    this.emit('shuttleUpdate', { loopId: this.id });
  }

  /**
   * Reset the loop to a clean state — despawns all virtual shuttles,
   * cancels crash timers, and clears crash segments. Checkpoint edge-
   * detection state is also reset so the next tick can spawn fresh.
   */
  reset(): void {
    this.crashDetector.clearLoop(this.id);
    this.shuttles.clear();
    this.movingShuttleQueue = [];
    this.crashedSegments = [];
    for (const cp of this.checkpoints) {
      cp.resetEdgeState();
    }
    this.emit('shuttleUpdate', { loopId: this.id });
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  /** Computed ETA in ms for segment from checkpoint at fromIdx. */
  private etaMs(fromIdx: number): number {
    const cp = this.checkpoints[fromIdx];
    return (cp.distanceMmToNext / this.avgSpeedMmPerSec) * 1000;
  }

  /** Next checkpoint index (wraps around for ring). */
  private nextIndex(idx: number): number {
    return (idx + 1) % this.checkpoints.length;
  }

  /** Previous checkpoint index. */
  private prevIndex(idx: number): number {
    return (idx - 1 + this.checkpoints.length) % this.checkpoints.length;
  }

  // ── Arrival handling ──────────────────────────────────────────────────────

  private handleArrival(cp: Checkpoint, idx: number): void {
    const prevIdx = this.prevIndex(idx);

    if (cp.type === 'IRM_ID') {
      const shuttleId = cp.detectedShuttleId;
      if (!shuttleId) return;

      // Ignore shuttle IDs not assigned to this loop
      const allowed = this.def.allowedShuttleIds;
      if (allowed.length > 0 && !allowed.includes(shuttleId)) return;

      let shuttle = this.shuttles.get(shuttleId);
      if (!shuttle) {
        // New shuttle entering the system
        shuttle = new VirtualShuttle(shuttleId, this.id, idx);
        this.shuttles.set(shuttleId, shuttle);
      }

      // Confirm arrival — clear crash timer for prev→current segment
      this.crashDetector.confirmArrival(this.id, prevIdx, idx);
      this.removeCrashSegment(prevIdx, idx);
      shuttle.arriveAt(idx);
      this.emit('shuttleUpdate', { loopId: this.id });

    } else if (cp.type === 'IRM') {
      // No ID — try the expected-queue first, then fall back to any shuttle
      // in the loop. This ensures the virtual shuttle snaps to the real
      // hardware position even when the queue is empty (e.g. after a crash
      // acknowledge, or when the real shuttle arrived before the virtual one).
      const shuttle = this.popExpectedShuttle(idx) ?? this.findAnyShuttleInLoop();
      if (shuttle) {
        this.crashDetector.confirmArrival(this.id, prevIdx, idx);
        this.removeCrashSegment(prevIdx, idx);
        shuttle.arriveAt(idx);
        this.emit('shuttleUpdate', { loopId: this.id });
      }

    } else {
      // SENSOR — confirm any shuttle was expected on this segment
      this.crashDetector.confirmArrival(this.id, prevIdx, idx);
      this.removeCrashSegment(prevIdx, idx);
      // Advance the moving shuttle (SENSOR checkpoints don't stop the shuttle)
      const shuttle = this.findMovingShuttleFor(prevIdx);
      if (shuttle) {
        const nextIdx = this.nextIndex(idx);
        shuttle.checkpointIndex = idx;
        shuttle.depart(this.etaMs(idx));
        const nextCp = this.checkpoints[nextIdx];
        this.crashDetector.startTracking(
          this.id, idx, nextIdx,
          shuttle.id, this.etaMs(idx), nextCp.bufferMs,
        );
        this.emit('shuttleUpdate', { loopId: this.id });
      }
    }
  }

  // ── GO handling (triggered by reading GO tag rising edge) ─────────────────

  /**
   * Called when the GO signal for checkpoint at `idx` transitions low→high.
   * This happens either because:
   *  - the PLC sent a GO pulse (real mode), or
   *  - the operator toggled/pulsed the GO tag in the Simulation panel,  or
   *  - the engine's sendGo() wrote a GO pulse that we now read back.
   */
  private handleGo(idx: number): void {
    const cp = this.checkpoints[idx];
    if (cp.type === 'SENSOR') return; // SENSOR has no GO

    const shuttle = this.findShuttleAt(idx);
    if (!shuttle || shuttle.status !== 'stopped') return;

    const eta     = this.etaMs(idx);
    const nextIdx = this.nextIndex(idx);
    const nextCp  = this.checkpoints[nextIdx];

    shuttle.depart(eta);

    // Queue shuttle for IRM (ID-less) arrival matching at the next checkpoint
    if (cp.type === 'IRM') {
      this.movingShuttleQueue.push(shuttle);
    }

    // Start crash-detection timer for this segment
    this.crashDetector.startTracking(
      this.id, idx, nextIdx,
      shuttle.id, eta, nextCp.bufferMs,
    );

    this.emit('shuttleUpdate', { loopId: this.id });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private markCrash(fromIdx: number, toIdx: number): void {
    const existing = this.crashedSegments.find(
      (s) => s.fromIndex === fromIdx && s.toIndex === toIdx,
    );
    if (!existing) {
      this.crashedSegments.push({ fromIndex: fromIdx, toIndex: toIdx });
    }
    // Mark the shuttle involved as crashed
    const shuttle = this.findMovingShuttleFor(fromIdx);
    if (shuttle) shuttle.crash();
  }

  private removeCrashSegment(fromIdx: number, toIdx: number): void {
    this.crashedSegments = this.crashedSegments.filter(
      (s) => !(s.fromIndex === fromIdx && s.toIndex === toIdx),
    );
  }

  private findShuttleAt(cpIdx: number): VirtualShuttle | undefined {
    for (const s of this.shuttles.values()) {
      if (s.checkpointIndex === cpIdx && s.status === 'stopped') return s;
    }
    return undefined;
  }

  private findMovingShuttleFor(fromIdx: number): VirtualShuttle | undefined {
    for (const s of this.shuttles.values()) {
      if (s.checkpointIndex === fromIdx && s.status === 'moving') return s;
    }
    return undefined;
  }

  private popExpectedShuttle(toIdx: number): VirtualShuttle | undefined {
    const idx = this.movingShuttleQueue.findIndex(
      (s) => s.checkpointIndex === this.prevIndex(toIdx),
    );
    if (idx === -1) return undefined;
    return this.movingShuttleQueue.splice(idx, 1)[0];
  }

  /**
   * Fallback for IRM arrivals when no shuttle is in the moving queue.
   * Returns the best candidate in the loop: prefers moving, then stopped,
   * then crashed. Used to snap the virtual shuttle to the real hardware
   * position when the queue is empty (e.g. after a crash acknowledge or
   * when the real shuttle arrived before the virtual one).
   */
  private findAnyShuttleInLoop(): VirtualShuttle | undefined {
    const all = [...this.shuttles.values()];
    return (
      all.find((s) => s.status === 'moving') ??
      all.find((s) => s.status === 'stopped') ??
      all[0]
    );
  }

  toState(): LoopState {
    const cpNames = this.checkpoints.map((c) => c.name);
    return {
      id:              this.def.id,
      name:            this.def.name,
      checkpoints:     this.checkpoints.map((cp) => cp.toState()),
      shuttles:        [...this.shuttles.values()].map((s) =>
        s.toState(this.id, cpNames[s.checkpointIndex] ?? ''),
      ),
      crashedSegments: [...this.crashedSegments],
    };
  }
}
