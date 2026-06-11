/**
 * /api/sim — simulation-mode REST endpoints.
 * Only functional when driver is SimulatedDriver.
 */
import { Router } from 'express';
import { z } from 'zod';
import { SimulatedDriver } from '../../opc/SimulatedDriver';
import { tagRegistry } from '../../opc/tagRegistry';
import type { PlcDriver } from '../../opc/PlcDriver';

const SetTagSchema = z.object({
  logicalName: z.string(),
  value:       z.union([z.boolean(), z.number()]),
});

export function createSimRouter(driver: PlcDriver): Router {
  const router = Router();

  // GET /api/sim/tags — return all current simulated tag values
  router.get('/tags', (_req, res) => {
    if (!(driver instanceof SimulatedDriver)) {
      res.status(400).json({ error: 'Not in simulation mode' });
      return;
    }
    const allTags = tagRegistry.getAll().map((tag) => ({
      ...tag,
      currentValue: driver.getAll()[tag.nodeId] ?? null,
    }));
    res.json(allTags);
  });

  // POST /api/sim/set — set a simulated tag value
  router.post('/set', (req, res) => {
    if (!(driver instanceof SimulatedDriver)) {
      res.status(400).json({ error: 'Not in simulation mode' });
      return;
    }
    const parsed = SetTagSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const tag = tagRegistry.getByName(parsed.data.logicalName);
    if (!tag) {
      res.status(404).json({ error: 'Unknown logical tag name' });
      return;
    }
    driver.setTag(tag.nodeId, parsed.data.value);
    res.json({ success: true });
  });

  return router;
}
