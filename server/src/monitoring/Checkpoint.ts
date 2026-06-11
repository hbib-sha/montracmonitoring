/**
 * Checkpoint — maintains the live I/O state of one physical checkpoint.
 * The monitoring engine reads tags each tick and calls updateFromSnapshot().
 *
 * Key design notes:
 *  - IRM_ID uses two independent spawn mechanisms:
 *      1. `arrivalEdge` (armed model): fires when `det && id > 0` — requires
 *         both signals simultaneously.
 *      2. `idChangedEdge`: fires when `rawShuttleId` transitions to a new
 *         non-zero value, independent of `det`. This is the primary spawn
 *         trigger; the det signal is used only for GO handling. Guarded
 *         against stale RS232 values by firing on *change*, not mere presence.
 *  - GO is now read back (direction 'readwrite'). When the PLC (or simulated
 *    user) sets the GO output true, the Loop reads the rising edge and
 *    departs the waiting shuttle. The engine does not "own" GO anymore.
 */
import type { CheckpointDef, CheckpointState, CheckpointType } from '../types';
import { tagRegistry } from '../opc/tagRegistry';

export class Checkpoint {
  // ── Live state ─────────────────────────────────────────────────────────
  public detecting = false;
  public detectedShuttleId?: number;
  public rawShuttleId = 0;   // IRM_ID only: raw ID value regardless of det
  public goSignalActive = false;

  // Edge flags — set by updateFromSnapshot(), consumed once by Loop.tick()
  public arrivalEdge    = false;
  public idChangedEdge  = false; // IRM_ID: rawShuttleId changed to a non-zero value
  public goEdge         = false;

  // Previous-tick state for edge detection
  private prevArmed  = false;
  private prevGo     = false;
  private prevRawId  = 0;

  constructor(public readonly def: CheckpointDef) {}

  // ── Accessors ──────────────────────────────────────────────────────────
  get id(): number             { return this.def.id; }
  get name(): string           { return this.def.name; }
  get type(): CheckpointType   { return this.def.type; }
  get sequence(): number       { return this.def.sequence; }
  get distanceMmToNext(): number { return this.def.distanceMmToNext; }
  get bufferMs(): number       { return this.def.bufferMs; }

  /** Node ID shortcuts (undefined if tag not configured). */
  get detNodeId(): string | undefined    { return tagRegistry.nodeIdFor(this.def.detTagId); }
  get idNodeId(): string | undefined     { return tagRegistry.nodeIdFor(this.def.idTagId); }
  get goNodeId(): string | undefined     { return tagRegistry.nodeIdFor(this.def.goTagId); }
  get signoffNodeId(): string | undefined { return tagRegistry.nodeIdFor(this.def.signoffTagId); }

  /**
   * All input node IDs this checkpoint needs polled each tick.
   * GO is included for IRM/IRM_ID so the engine reads the GO signal
   * from the PLC (real) or from SimulatedDriver (sim).
   */
  get inputNodeIds(): string[] {
    const ids: string[] = [];
    if (this.def.type === 'IRM_ID') {
      if (this.detNodeId) ids.push(this.detNodeId);
      if (this.idNodeId)  ids.push(this.idNodeId);
      if (this.goNodeId)  ids.push(this.goNodeId);
    } else if (this.def.type === 'IRM') {
      if (this.detNodeId) ids.push(this.detNodeId);
      if (this.goNodeId)  ids.push(this.goNodeId);
    } else {
      // SENSOR
      if (this.signoffNodeId) ids.push(this.signoffNodeId);
    }
    return ids;
  }

  /**
   * Update state from a fresh tag-value snapshot.
   *
   * Sets `arrivalEdge = true` when a shuttle has newly become fully detected
   * (order-independent: works whether DET or ID is set first).
   * Sets `goEdge = true` when the GO signal transitions from false → true.
   *
   * Returns true for backward-compat (= arrivalEdge), but callers should
   * prefer reading the public flags directly after this call.
   */
  updateFromSnapshot(
    snapshot: Record<string, boolean | number | string>,
  ): boolean {
    let armed = false;

    if (this.def.type === 'IRM_ID') {
      const det   = this.detNodeId ? Boolean(snapshot[this.detNodeId]) : false;
      const rawId = this.idNodeId  ? Number(snapshot[this.idNodeId])   : 0;
      this.detecting         = det;
      this.rawShuttleId      = rawId;
      this.detectedShuttleId = det && rawId > 0 ? rawId : undefined;
      // ID-changed edge: rawId transitioned to a new non-zero value (change guard
      // prevents re-firing on stale RS232 values that linger after departure)
      this.idChangedEdge = rawId > 0 && rawId !== this.prevRawId;
      this.prevRawId     = rawId;
      // Armed when BOTH det is true AND a valid ID is present — order-independent
      armed = det && rawId > 0;

    } else if (this.def.type === 'IRM') {
      this.detecting = this.detNodeId ? Boolean(snapshot[this.detNodeId]) : false;
      armed = this.detecting;

    } else {
      // SENSOR — no GO; armed when the signoff signal is present
      this.detecting = this.signoffNodeId
        ? Boolean(snapshot[this.signoffNodeId])
        : false;
      armed = this.detecting;
    }

    // Arrival edge — only on armed rising edge
    this.arrivalEdge = armed && !this.prevArmed;
    this.prevArmed   = armed;

    // GO edge — only for IRM / IRM_ID
    if (this.def.type === 'IRM_ID' || this.def.type === 'IRM') {
      const go       = this.goNodeId ? Boolean(snapshot[this.goNodeId]) : false;
      this.goSignalActive = go;
      this.goEdge    = go && !this.prevGo;
      this.prevGo    = go;
    } else {
      this.goEdge    = false;
    }

    return this.arrivalEdge;
  }

  /** Reset edge-detection state so the next tick starts fresh. */
  resetEdgeState(): void {
    this.prevArmed      = false;
    this.prevGo         = false;
    this.prevRawId      = 0;
    this.rawShuttleId   = 0;
    this.arrivalEdge    = false;
    this.idChangedEdge  = false;
    this.goEdge         = false;
  }

  toState(): CheckpointState {
    return {
      id:                this.id,
      name:              this.name,
      type:              this.type,
      detecting:         this.detecting,
      detectedShuttleId: this.detectedShuttleId,
      goSignalActive:    this.goSignalActive,
    };
  }
}
