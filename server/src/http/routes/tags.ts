import { Router } from 'express';
import { tagRepo } from '../../db/repositories/tagRepo';
import { z } from 'zod';

const router = Router();

const TagSchema = z.object({
  logicalName: z.string().min(1),
  nodeId:      z.string().min(1),
  dataType:    z.enum(['Boolean', 'Int32', 'Float', 'String']).default('Boolean'),
  direction:   z.enum(['read', 'write', 'readwrite']).default('read'),
  description: z.string().default(''),
});

router.get('/', (_req, res) => {
  res.json(tagRepo.getAll());
});

router.put('/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const parsed = TagSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const existing = tagRepo.getById(id);
  if (!existing) {
    res.status(404).json({ error: 'Tag not found' });
    return;
  }
  tagRepo.upsert({ ...existing, ...parsed.data });
  res.json({ success: true });
});

export default router;
