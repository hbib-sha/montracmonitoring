import type { ShuttleStatus, VirtualShuttleState } from '../types';

export class VirtualShuttle {
  public status: ShuttleStatus = 'stopped';
  public checkpointIndex: number;
  public movedAtMs?: number;
  public etaMs?: number;

  constructor(
    public readonly id: number,
    public readonly loopId: number,
    initialCheckpointIndex: number,
  ) {
    this.checkpointIndex = initialCheckpointIndex;
  }

  /** Mark shuttle as stopped at the given checkpoint index. */
  arriveAt(cpIndex: number): void {
    this.checkpointIndex = cpIndex;
    this.status = 'stopped';
    this.movedAtMs = undefined;
    this.etaMs = undefined;
  }

  /** Mark shuttle as moving. Record departure time and expected travel time. */
  depart(etaMs: number): void {
    this.status = 'moving';
    this.movedAtMs = Date.now();
    this.etaMs = etaMs;
  }

  /** Mark shuttle as crashed. */
  crash(): void {
    this.status = 'crashed';
  }

  /** Milliseconds since the shuttle departed. */
  get elapsedSinceDepatureMs(): number {
    if (!this.movedAtMs) return 0;
    return Date.now() - this.movedAtMs;
  }

  /** True if the shuttle has exceeded ETA + buffer. */
  isOverdue(bufferMs: number): boolean {
    if (this.status !== 'moving' || !this.etaMs) return false;
    return this.elapsedSinceDepatureMs > this.etaMs + bufferMs;
  }

  toState(loopId: number, cpName: string): VirtualShuttleState {
    return {
      id:              this.id,
      loopId,
      checkpointIndex: this.checkpointIndex,
      status:          this.status,
      stoppedAtName:   this.status === 'stopped' ? cpName : undefined,
      movedAtMs:       this.movedAtMs,
      etaMs:           this.etaMs,
    };
  }
}
