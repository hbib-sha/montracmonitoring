/**
 * Calibration REST routes — control a calibration session and apply results.
 * Mounted behind requireAuth in app.ts.
 *
 * Status changes are broadcast over the socket by the service's 'statusChanged'
 * event (wired in gateway.ts), so these handlers only return the latest status.
 */
import { Router } from 'express';
import { z } from 'zod';
import type { CalibrationService } from '../../calibration/CalibrationService';

const LoopSchema = z.object({
  loopId: z.number().int().positive(),
});

const ApplySchema = z.object({
  loopId:    z.number().int().positive(),
  distances: z.record(z.string(), z.number().int().min(1)).optional(),
});

export function createCalibrationRouter(calibration: CalibrationService): Router {
  const router = Router();

  // ── Status ──────────────────────────────────────────────────────────────────
  router.get('/status', (_req, res) => {
    res.json(calibration.getStatus());
  });

  // ── Start ─────────────────────────────────────────────────────────────────────
  router.post('/start', (req, res) => {
    const parsed = LoopSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    try {
      const status = calibration.start(parsed.data.loopId);
      res.json({ success: true, status });
    } catch (err) {
      res.status(404).json({ error: String(err instanceof Error ? err.message : err) });
    }
  });

  // ── Stop ──────────────────────────────────────────────────────────────────────
  router.post('/stop', (_req, res) => {
    res.json({ success: true, status: calibration.stop() });
  });

  // ── Proposal (before/after) ──────────────────────────────────────────────────
  router.get('/propose', (req, res) => {
    const loopId = req.query.loopId ? parseInt(req.query.loopId as string, 10) : NaN;
    if (isNaN(loopId)) { res.status(400).json({ error: 'Invalid loopId' }); return; }
    try {
      res.json(calibration.propose(loopId));
    } catch (err) {
      res.status(404).json({ error: String(err instanceof Error ? err.message : err) });
    }
  });

  // ── Apply ─────────────────────────────────────────────────────────────────────
  router.post('/apply', (req, res) => {
    const parsed = ApplySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    try {
      // zod gives Record<string, number>; checkpoint ids are numeric keys
      const distances = parsed.data.distances
        ? Object.fromEntries(
            Object.entries(parsed.data.distances).map(([k, v]) => [Number(k), v]),
          )
        : undefined;
      const applied = calibration.apply(parsed.data.loopId, distances);
      res.json({ success: true, applied });
    } catch (err) {
      res.status(400).json({ error: String(err instanceof Error ? err.message : err) });
    }
  });

  return router;
}
