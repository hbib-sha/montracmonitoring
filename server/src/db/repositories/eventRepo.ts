import { db } from '../index';
import type { CrashEvent } from '../../types';

type EventRow = {
  id: number;
  loop_id: number;
  loop_name: string;
  segment_from: number;
  segment_to: number;
  created_at: string;
  resolved_at: string | null;
  acknowledged: number;
};

function mapRow(r: EventRow): CrashEvent {
  return {
    id:           r.id,
    loopId:       r.loop_id,
    loopName:     r.loop_name,
    segmentFrom:  r.segment_from,
    segmentTo:    r.segment_to,
    createdAt:    r.created_at,
    resolvedAt:   r.resolved_at ?? undefined,
    acknowledged: r.acknowledged === 1,
  };
}

export const eventRepo = {
  getRecent(limit = 100): CrashEvent[] {
    const rows = db.prepare(
      `SELECT e.*, l.name AS loop_name
       FROM events e JOIN loops l ON l.id = e.loop_id
       ORDER BY e.created_at DESC LIMIT ?`,
    ).all(limit) as EventRow[];
    return rows.map(mapRow);
  },

  create(loopId: number, segmentFrom: number, segmentTo: number): number {
    const result = db.prepare(
      `INSERT INTO events (loop_id, segment_from, segment_to) VALUES (?, ?, ?)`,
    ).run(loopId, segmentFrom, segmentTo);
    return result.lastInsertRowid as number;
  },

  acknowledge(id: number): void {
    db.prepare(
      `UPDATE events SET acknowledged = 1, resolved_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
       WHERE id = ?`,
    ).run(id);
  },

  acknowledgeAll(): void {
    db.prepare(
      `UPDATE events SET acknowledged = 1, resolved_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
       WHERE acknowledged = 0`,
    ).run();
  },
};
