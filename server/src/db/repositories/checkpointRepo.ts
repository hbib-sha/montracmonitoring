import { db } from '../index';

export const checkpointRepo = {
  /**
   * Overwrite the calibrated timing fields for one checkpoint.
   * Used by the auto-calibration flow: distance drives the ETA, buffer is the
   * ±tolerance window before a crash fires.
   */
  updateDistanceAndBuffer(id: number, distanceMm: number, bufferMs: number): void {
    db.prepare(
      'UPDATE checkpoints SET distance_mm_to_next = ?, buffer_ms = ? WHERE id = ?',
    ).run(distanceMm, bufferMs, id);
  },
};
