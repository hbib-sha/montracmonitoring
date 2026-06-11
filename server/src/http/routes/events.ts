import { Router } from 'express';
import { eventRepo } from '../../db/repositories/eventRepo';

const router = Router();

router.get('/', (_req, res) => {
  const limit = parseInt((_req.query as { limit?: string }).limit ?? '100', 10);
  res.json(eventRepo.getRecent(limit));
});

router.post('/acknowledge-all', (_req, res) => {
  eventRepo.acknowledgeAll();
  res.json({ success: true });
});

export default router;
