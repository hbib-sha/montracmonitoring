/**
 * POST /api/override/arena
 * Writes LU/ST/RU_ARENA boolean tags directly (REST fallback; WS is preferred).
 */
import { Router } from 'express';
import { z } from 'zod';
import { tagRepo } from '../../db/repositories/tagRepo';
import type { PlcDriver } from '../../opc/PlcDriver';

const OverrideSchema = z.object({
  direction: z.enum(['left', 'straight', 'right']),
  lu_tag:    z.string().optional(),
  st_tag:    z.string().optional(),
  ru_tag:    z.string().optional(),
});

export function createOverrideRouter(driver: PlcDriver): Router {
  const router = Router();

  router.post('/arena', async (req, res) => {
    const parsed = OverrideSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const { direction, lu_tag, st_tag, ru_tag } = parsed.data;

    // Resolve node IDs — prefer explicit tag in body, fall back to DB
    const resolve = (logicalName: string, explicit?: string): string | undefined =>
      explicit ?? tagRepo.getByLogicalName(logicalName)?.nodeId;

    const lu_id = resolve('LU_ARENA', lu_tag);
    const st_id = resolve('ST_ARENA', st_tag);
    const ru_id = resolve('RU_ARENA', ru_tag);

    if (!lu_id || !st_id || !ru_id) {
      res.status(500).json({ error: 'Arena tag node IDs not configured' });
      return;
    }

    const ok = await driver.writeMany([
      { nodeId: lu_id, value: direction === 'left' },
      { nodeId: st_id, value: direction === 'straight' },
      { nodeId: ru_id, value: direction === 'right' },
    ]);

    res.json({ success: ok });
  });

  return router;
}
