/**
 * Recording REST routes — control runs and serve report data.
 * All routes are mounted behind requireAuth in app.ts.
 */
import { Router } from 'express';
import { z } from 'zod';
import type { RecordingService } from '../../recording/RecordingService';
import { recordingRepo } from '../../db/repositories/recordingRepo';
import type { RecordingSample, SegmentTiming, CrashMarker } from '../../types';

const StartSchema = z.object({
  name: z.string().min(1).max(120),
});

const CrashMarkerSchema = z.object({
  loopId:          z.number().int().positive(),
  actualCrashAtMs: z.number().int().optional(), // defaults to now
  note:            z.string().max(500).optional(),
});

export function createRecordingRouter(
  recordingService: RecordingService,
  broadcastStatus: () => void,
): Router {
  const router = Router();

  // ── Status ──────────────────────────────────────────────────────────────────
  router.get('/status', (_req, res) => {
    res.json(recordingService.getStatus());
  });

  // ── Start recording ─────────────────────────────────────────────────────────
  router.post('/start', (req, res) => {
    const parsed = StartSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const run = recordingService.start(parsed.data.name);
    broadcastStatus();
    res.json({ success: true, run });
  });

  // ── Stop recording ──────────────────────────────────────────────────────────
  router.post('/stop', (_req, res) => {
    const run = recordingService.stop();
    broadcastStatus();
    res.json({ success: true, run });
  });

  // ── List runs ───────────────────────────────────────────────────────────────
  router.get('/runs', (_req, res) => {
    res.json(recordingRepo.listRuns());
  });

  // ── Get single run (with aggregate counts) ──────────────────────────────────
  router.get('/runs/:id', (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }
    const run = recordingRepo.getRun(id);
    if (!run) { res.status(404).json({ error: 'Not found' }); return; }
    res.json(run);
  });

  // ── Samples ─────────────────────────────────────────────────────────────────
  router.get('/runs/:id/samples', (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }
    res.json(recordingRepo.getSamples(id));
  });

  // ── Segment timings ─────────────────────────────────────────────────────────
  router.get('/runs/:id/segments', (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }
    res.json(recordingRepo.getSegmentTimings(id));
  });

  // ── Crash markers ───────────────────────────────────────────────────────────
  router.get('/runs/:id/crashes', (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }
    res.json(recordingRepo.getCrashMarkers(id));
  });

  router.post('/runs/:id/crash-marker', (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }

    const run = recordingRepo.getRun(id);
    if (!run) { res.status(404).json({ error: 'Run not found' }); return; }

    const parsed = CrashMarkerSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const { loopId, actualCrashAtMs = Date.now(), note = '' } = parsed.data;

    // If this is the active run, use the service (which may pair future events)
    // Otherwise insert directly
    let marker: CrashMarker | null;
    if (recordingService.getStatus().run?.id === id) {
      marker = recordingService.markActualCrash(loopId, actualCrashAtMs, note);
    } else {
      marker = recordingRepo.createCrashMarker(id, loopId, actualCrashAtMs, note);
    }

    res.json({ success: true, marker });
  });

  // ── Export (CSV or JSON) ────────────────────────────────────────────────────
  router.get('/runs/:id/export', (req, res) => {
    const id     = parseInt(req.params.id, 10);
    const format = req.query.format === 'csv' ? 'csv' : 'json';
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }

    const run      = recordingRepo.getRun(id);
    if (!run) { res.status(404).json({ error: 'Not found' }); return; }

    const samples  = recordingRepo.getSamples(id);
    const segments = recordingRepo.getSegmentTimings(id);
    const crashes  = recordingRepo.getCrashMarkers(id);

    if (format === 'json') {
      res.setHeader('Content-Disposition', `attachment; filename="run-${id}.json"`);
      res.setHeader('Content-Type', 'application/json');
      res.json({ run, samples, segments, crashes });
      return;
    }

    // CSV — flatten three sections
    const lines: string[] = [];

    lines.push('=== RUN ===');
    lines.push('id,name,startedAt,endedAt,status,mode,sampleIntervalMs,notes');
    lines.push([run.id, csvEsc(run.name), run.startedAt, run.endedAt ?? '', run.status, run.mode, run.sampleIntervalMs, csvEsc(run.notes)].join(','));

    lines.push('');
    lines.push('=== SAMPLES ===');
    lines.push('id,t,connected,mode,activeShuttleCount,crashedCount');
    for (const s of samples as RecordingSample[]) {
      lines.push([s.id, s.t, s.connected ? 1 : 0, s.mode, s.activeShuttleCount, s.crashedCount].join(','));
    }

    lines.push('');
    lines.push('=== SEGMENT TIMINGS ===');
    lines.push('id,loopId,shuttleId,fromIndex,toIndex,predictedEtaMs,actualElapsedMs,recordedAt');
    for (const t of segments as SegmentTiming[]) {
      lines.push([t.id, t.loopId, t.shuttleId, t.fromIndex, t.toIndex, t.predictedEtaMs, t.actualElapsedMs, t.recordedAt].join(','));
    }

    lines.push('');
    lines.push('=== CRASH MARKERS ===');
    lines.push('id,loopId,actualCrashAtMs,detectedAtMs,detectionLatencyMs,detectedEventId,note,createdAt');
    for (const m of crashes as CrashMarker[]) {
      lines.push([m.id, m.loopId, m.actualCrashAtMs, m.detectedAtMs ?? '', m.detectionLatencyMs ?? '', m.detectedEventId ?? '', csvEsc(m.note), m.createdAt].join(','));
    }

    res.setHeader('Content-Disposition', `attachment; filename="run-${id}.csv"`);
    res.setHeader('Content-Type', 'text/csv');
    res.send(lines.join('\r\n'));
  });

  // ── Delete single run ───────────────────────────────────────────────────────
  router.delete('/runs/:id', (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }
    recordingRepo.deleteRun(id);
    res.json({ success: true });
  });

  // ── Clear all runs ──────────────────────────────────────────────────────────
  router.delete('/runs', (_req, res) => {
    recordingRepo.clearAll();
    res.json({ success: true });
  });

  return router;
}

function csvEsc(s: string): string {
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
