/**
 * SimulatedDriver — in-memory tag store with no real PLC connection.
 * Allows full UI testing / demo without hardware.
 *
 * Key change: write() and writeMany() now emit 'tagChanged' (same as setTag)
 * so that every system-written output (GO pulse, ARENA LU/ST/RU, light-tower,
 * buzzer) is immediately broadcast to connected clients via the gateway.
 * Previously only manual sim-override calls emitted 'tagChanged', making
 * system outputs invisible in the simulation panel.
 */
import type { PlcDriver } from './PlcDriver';
import { EventEmitter } from 'events';
import pino from 'pino';

const logger = pino({ name: 'SimulatedDriver' });

export class SimulatedDriver extends EventEmitter implements PlcDriver {
  private tags: Map<string, boolean | number | string> = new Map();
  private _connected = false;

  get isConnected(): boolean {
    return this._connected;
  }

  async connect(): Promise<void> {
    this._connected = true;
    logger.info('SimulatedDriver connected (no real PLC)');
  }

  async read(nodeId: string): Promise<boolean | number | string | undefined> {
    return this.tags.get(nodeId);
  }

  async readMany(
    nodeIds: string[],
  ): Promise<Record<string, boolean | number | string>> {
    const out: Record<string, boolean | number | string> = {};
    for (const id of nodeIds) {
      const val = this.tags.get(id);
      if (val !== undefined) out[id] = val;
      else out[id] = false; // default unset boolean tags to false
    }
    return out;
  }

  async write(nodeId: string, value: boolean | number): Promise<boolean> {
    this.tags.set(nodeId, value);
    this.emit('tagChanged', { nodeId, value });
    logger.debug({ nodeId, value }, 'sim write');
    return true;
  }

  async writeMany(
    entries: Array<{ nodeId: string; value: boolean | number }>,
  ): Promise<boolean> {
    for (const { nodeId, value } of entries) {
      this.tags.set(nodeId, value);
    }
    // Emit a single tagChanged after all writes so the gateway does one broadcast
    this.emit('tagChanged', { nodeId: null, value: null });
    logger.debug({ count: entries.length }, 'sim writeMany');
    return true;
  }

  async dispose(): Promise<void> {
    this._connected = false;
    this.tags.clear();
  }

  // ── Sim-specific API called by /api/sim route and gateway simSetTag ────────
  setTag(nodeId: string, value: boolean | number | string): void {
    this.tags.set(nodeId, value);
    this.emit('tagChanged', { nodeId, value });
    logger.debug({ nodeId, value }, 'sim override');
  }

  getAll(): Record<string, boolean | number | string> {
    return Object.fromEntries(this.tags);
  }
}
