/**
 * PlcDriver — abstract interface implemented by both OpcUaDriver (real)
 * and SimulatedDriver (sim mode). The monitoring engine and alarm manager
 * only interact via this interface.
 */
export interface PlcDriver {
  /** Establish connection to the PLC (or initialise sim state). */
  connect(): Promise<void>;

  /** Read a single tag value. Returns undefined if tag not found / error. */
  read(nodeId: string): Promise<boolean | number | string | undefined>;

  /**
   * Bulk-read multiple tags. Returns a map of nodeId → value.
   * Unreadable tags are omitted from the result.
   */
  readMany(nodeIds: string[]): Promise<Record<string, boolean | number | string>>;

  /**
   * Write a single boolean or numeric value to a tag.
   * Returns true if the write succeeded.
   */
  write(nodeId: string, value: boolean | number): Promise<boolean>;

  /**
   * Bulk-write multiple tags at once (atomic where supported).
   * Each entry: { nodeId, value }
   */
  writeMany(entries: Array<{ nodeId: string; value: boolean | number }>): Promise<boolean>;

  /** True while a valid connection / session is active. */
  readonly isConnected: boolean;

  /** Tear down connection cleanly. */
  dispose(): Promise<void>;
}
