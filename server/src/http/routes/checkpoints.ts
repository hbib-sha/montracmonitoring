import { Router } from 'express';
import { z } from 'zod';
import { db } from '../../db/index';

type CheckpointRow = {
  id: number;
  loop_id: number;
  sequence: number;
  name: string;
  type: string;
  distance_mm_to_next: number;
  buffer_ms: number;
};

const CheckpointUpdateSchema = z.object({
  distanceMmToNext: z.number().int().min(1).optional(),
  bufferMs:         z.number().int().min(0).optional(),
  name:             z.string().min(1).optional(),
});

const router = Router();

// GET /api/checkpoints?loopId=1 — list checkpoints for a loop
router.get('/', (req, res) => {
  const loopId = req.query.loopId ? parseInt(req.query.loopId as string, 10) : null;
  const rows = loopId
    ? (db.prepare('SELECT * FROM checkpoints WHERE loop_id = ? ORDER BY sequence').all(loopId) as CheckpointRow[])
    : (db.prepare('SELECT * FROM checkpoints ORDER BY loop_id, sequence').all() as CheckpointRow[]);

  res.json(rows.map((r) => ({
    id:               r.id,
    loopId:           r.loop_id,
    sequence:         r.sequence,
    name:             r.name,
    type:             r.type,
    distanceMmToNext: r.distance_mm_to_next,
    bufferMs:         r.buffer_ms,
  })));
});

// PUT /api/checkpoints/:id — update distance and/or buffer for one checkpoint
router.put('/:id', (req, res) => {
  const id     = parseInt(req.params.id, 10);
  const parsed = CheckpointUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const existing = db.prepare('SELECT id FROM checkpoints WHERE id = ?').get(id);
  if (!existing) {
    res.status(404).json({ error: 'Checkpoint not found' });
    return;
  }
  const { distanceMmToNext, bufferMs, name } = parsed.data;
  db.prepare(
    `UPDATE checkpoints SET
       distance_mm_to_next = COALESCE(?, distance_mm_to_next),
       buffer_ms           = COALESCE(?, buffer_ms),
       name                = COALESCE(?, name)
     WHERE id = ?`,
  ).run(
    distanceMmToNext ?? null,
    bufferMs ?? null,
    name ?? null,
    id,
  );
  res.json({ success: true });
});

export default router;
