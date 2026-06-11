import { Router } from 'express';
import { z } from 'zod';
import { db } from '../../db/index';

type LoopRow = {
  id: number;
  name: string;
  description: string;
  allowed_shuttle_ids: string;
};

const LoopUpdateSchema = z.object({
  allowedShuttleIds: z.array(z.number().int().positive()),
  description: z.string().optional(),
});

const router = Router();

router.get('/', (_req, res) => {
  const rows = db.prepare('SELECT * FROM loops ORDER BY id').all() as LoopRow[];
  res.json(
    rows.map((r) => ({
      id:                r.id,
      name:              r.name,
      description:       r.description,
      allowedShuttleIds: JSON.parse(r.allowed_shuttle_ids || '[]') as number[],
    })),
  );
});

router.put('/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const parsed = LoopUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const existing = db.prepare('SELECT id FROM loops WHERE id = ?').get(id);
  if (!existing) {
    res.status(404).json({ error: 'Loop not found' });
    return;
  }
  const { allowedShuttleIds, description } = parsed.data;
  db.prepare(
    'UPDATE loops SET allowed_shuttle_ids = ?, description = COALESCE(?, description) WHERE id = ?',
  ).run(JSON.stringify(allowedShuttleIds), description ?? null, id);
  res.json({ success: true });
});

export default router;
