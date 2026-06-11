import { Router } from 'express';
import { settingsRepo } from '../../db/repositories/settingsRepo';
import { z } from 'zod';

const router = Router();

const SettingsSchema = z.object({
  opcEndpoint:       z.string().optional(),
  mode:              z.enum(['real', 'simulation']).optional(),
  alarmAutoOffMs:    z.number().int().positive().optional(),
  avgSpeedMmPerSec:  z.number().positive().optional(),
  lightTowerNodeId:  z.string().optional(),
  buzzerNodeId:      z.string().optional(),
  pushButton1NodeId: z.string().optional(),
});

router.get('/', (_req, res) => {
  res.json(settingsRepo.getAll());
});

router.put('/', (req, res) => {
  const parsed = SettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  settingsRepo.setMany(parsed.data);
  res.json({ success: true, settings: settingsRepo.getAll() });
});

export default router;
