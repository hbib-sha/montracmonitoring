/**
 * crashDetection — tracks per-segment overdue timers.
 * When a shuttle departs checkpoint i, we start a deadline for arrival at i+1.
 * If the deadline passes without confirmation, a crash is reported.
 */
import { EventEmitter } from 'events';

export interface CrashPayload {
  loopId: number;
  fromIndex: number;  // checkpoint index shuttle departed from
  toIndex: number;    // checkpoint index it was heading to
  shuttleId: number;
}

export declare interface CrashDetector {
  on(event: 'crash', listener: (payload: CrashPayload) => void): this;
  emit(event: 'crash', payload: CrashPayload): boolean;
}

export class CrashDetector extends EventEmitter {
  // key: `${loopId}-${fromIndex}-${toIndex}`
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  // Which shuttles are being tracked on a segment
  private shuttleOnSegment = new Map<string, number>(); // key → shuttleId

  startTracking(
    loopId: number,
    fromIndex: number,
    toIndex: number,
    shuttleId: number,
    etaMs: number,
    bufferMs: number,
  ): void {
    const key = `${loopId}-${fromIndex}-${toIndex}`;
    this.clearSegment(key);

    this.shuttleOnSegment.set(key, shuttleId);
    const timer = setTimeout(() => {
      this.timers.delete(key);
      this.shuttleOnSegment.delete(key);
      this.emit('crash', { loopId, fromIndex, toIndex, shuttleId });
    }, etaMs + bufferMs);

    this.timers.set(key, timer);
  }

  /** Call when shuttle is confirmed at toIndex — clears the timer. */
  confirmArrival(loopId: number, fromIndex: number, toIndex: number): void {
    const key = `${loopId}-${fromIndex}-${toIndex}`;
    this.clearSegment(key);
  }

  /** Clear all active timers for a loop (e.g. after crash ack). */
  clearLoop(loopId: number): void {
    for (const key of this.timers.keys()) {
      if (key.startsWith(`${loopId}-`)) {
        this.clearSegment(key);
      }
    }
  }

  clearAll(): void {
    for (const key of [...this.timers.keys()]) {
      this.clearSegment(key);
    }
  }

  private clearSegment(key: string): void {
    const existing = this.timers.get(key);
    if (existing) {
      clearTimeout(existing);
      this.timers.delete(key);
    }
    this.shuttleOnSegment.delete(key);
  }
}
