/**
 * MonitoringEngine — orchestrates all loops.
 * Polls input tags on a fixed interval and drives each Loop's tick().
 * Exposes sendGo() for operator-initiated GO signals.
 * Emits 'stateChanged' and 'crash' events consumed by the alarm manager
 * and WebSocket gateway.
 */
import { EventEmitter } from 'events';
import type { PlcDriver } from '../opc/PlcDriver';
import { tagRegistry } from '../opc/tagRegistry';
import { db } from '../db/index';
import { Loop } from './Loop';
import type { LoopDef, CheckpointDef } from '../types';
import type { CrashPayload } from './crashDetection';
import type { ShuttleAdvancedPayload } from '../types';
import pino from 'pino';

const logger = pino({ name: 'MonitoringEngine' });

type LoopRow    = { id: number; name: string; description: string; allowed_shuttle_ids: string };
type CpRow      = {
  id: number; loop_id: number; sequence: number; name: string; type: string;
  distance_mm_to_next: number; buffer_ms: number;
  det_tag_id: number | null; id_tag_id: number | null; go_tag_id: number | null;
  signoff_tag_id: number | null;
};

export declare interface MonitoringEngine {
  on(event: 'stateChanged', listener: () => void): this;
  on(event: 'crash', listener: (payload: CrashPayload) => void): this;
  on(event: 'shuttleAdvanced', listener: (payload: ShuttleAdvancedPayload) => void): this;
}

export class MonitoringEngine extends EventEmitter {
  private loops: Loop[] = [];
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private avgSpeedMmPerSec: number;

  constructor(
    private driver: PlcDriver,
    private pollIntervalMs: number,
    avgSpeedMmPerSec: number,
  ) {
    super();
    this.avgSpeedMmPerSec = avgSpeedMmPerSec;
  }

  /** Load loop & checkpoint definitions from DB and start polling. */
  start(): void {
    this.loadLoops();

    this.pollTimer = setInterval(async () => {
      await this.tick();
    }, this.pollIntervalMs);

    logger.info(
      { loops: this.loops.length, pollMs: this.pollIntervalMs },
      'MonitoringEngine started',
    );
  }

  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    for (const loop of this.loops) {
      loop.removeAllListeners();
    }
    this.loops = [];
  }

  /** Update average speed (settings change). */
  setAvgSpeed(mmPerSec: number): void {
    this.avgSpeedMmPerSec = mmPerSec;
    for (const loop of this.loops) {
      loop.setAvgSpeed(mmPerSec);
    }
  }

  /** Reload loops from DB and restart. */
  reload(avgSpeedMmPerSec: number): void {
    this.stop();
    this.avgSpeedMmPerSec = avgSpeedMmPerSec;
    tagRegistry.reload();
    this.loadLoops();
    this.start();
  }

  getLoops(): Loop[] {
    return this.loops;
  }

  getLoopById(id: number): Loop | undefined {
    return this.loops.find((l) => l.id === id);
  }

  /**
   * Send GO signal to a checkpoint — writes a ~600ms pulse to the driver.
   * The Loop reacts when it reads the GO rising edge on the next tick;
   * we no longer depart the shuttle directly from here so that both real
   * (PLC-sent GO) and simulated (user-toggled or button-pulsed GO) paths
   * go through the same read-edge code in Loop.tick().
   */
  async sendGo(checkpointId: number): Promise<boolean> {
    for (const loop of this.loops) {
      const cp = loop.checkpoints.find((c) => c.id === checkpointId);
      if (cp && cp.goNodeId) {
        const ok = await this.driver.write(cp.goNodeId, true);
        if (ok) {
          // Reset GO after 600ms (pulse duration slightly longer than one poll cycle)
          setTimeout(async () => {
            await this.driver.write(cp.goNodeId!, false);
          }, 600);
        }
        return ok;
      }
    }
    return false;
  }

  clearCrashes(loopId: number): void {
    const loop = this.getLoopById(loopId);
    loop?.clearCrashes();
  }

  resetLoop(loopId: number): void {
    const loop = this.getLoopById(loopId);
    loop?.reset();
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private loadLoops(): void {
    const loopRows = db.prepare('SELECT * FROM loops').all() as LoopRow[];
    const cpRows   = db.prepare(
      'SELECT * FROM checkpoints ORDER BY loop_id, sequence',
    ).all() as CpRow[];

    this.loops = loopRows.map((lr) => {
      const checkpoints: CheckpointDef[] = cpRows
        .filter((r) => r.loop_id === lr.id)
        .map((r) => ({
          id:                r.id,
          loopId:            r.loop_id,
          sequence:          r.sequence,
          name:              r.name,
          type:              r.type as CheckpointDef['type'],
          distanceMmToNext:  r.distance_mm_to_next,
          bufferMs:          r.buffer_ms,
          detTagId:          r.det_tag_id ?? undefined,
          idTagId:           r.id_tag_id ?? undefined,
          goTagId:           r.go_tag_id ?? undefined,
          signoffTagId:      r.signoff_tag_id ?? undefined,
        }));

      const loopDef: LoopDef = {
        id:                 lr.id,
        name:               lr.name,
        description:        lr.description,
        checkpoints,
        allowedShuttleIds:  JSON.parse(lr.allowed_shuttle_ids || '[]') as number[],
      };

      const loop = new Loop(loopDef, this.avgSpeedMmPerSec);

      loop.on('crash', (payload) => {
        this.emit('crash', payload);
      });
      loop.on('shuttleAdvanced', (payload) => {
        this.emit('shuttleAdvanced', payload);
      });
      loop.on('shuttleUpdate', () => {
        this.emit('stateChanged');
      });

      return loop;
    });
  }

  private async tick(): Promise<void> {
    if (!this.driver.isConnected) return;

    // Collect all needed input node IDs across all loops
    const nodeIds = [
      ...new Set(this.loops.flatMap((l) => l.allInputNodeIds)),
    ];
    if (nodeIds.length === 0) return;

    const snapshot = await this.driver.readMany(nodeIds);

    for (const loop of this.loops) {
      loop.tick(snapshot);
    }
  }
}
