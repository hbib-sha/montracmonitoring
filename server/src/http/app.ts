import express from 'express';
import session from 'express-session';
import path from 'path';
import { config } from '../config/env';
import { loginHandler, logoutHandler, meHandler, requireAuth } from './auth';
import settingsRouter from './routes/settings';
import tagsRouter from './routes/tags';
import eventsRouter from './routes/events';
import loopsRouter from './routes/loops';
import checkpointsRouter from './routes/checkpoints';
import { createOverrideRouter } from './routes/override';
import { createSimRouter } from './routes/sim';
import { createRecordingRouter } from './routes/recording';
import { createCalibrationRouter } from './routes/calibration';
import type { PlcDriver } from '../opc/PlcDriver';
import type { RecordingService } from '../recording/RecordingService';
import type { CalibrationService } from '../calibration/CalibrationService';

export function createApp(
  driver: PlcDriver,
  recordingService: RecordingService,
  broadcastRecordingStatus: () => void,
  calibrationService: CalibrationService,
): express.Application {
  const app = express();

  app.use(express.json());
  app.use(
    session({
      secret:            config.sessionSecret,
      resave:            false,
      saveUninitialized: false,
      cookie: {
        secure:   false, // set true behind HTTPS in production
        maxAge:   8 * 60 * 60 * 1000, // 8 hours
        httpOnly: true,
      },
    }),
  );

  // ── Auth ──────────────────────────────────────────────────────────────────
  app.post('/api/auth/login',  loginHandler);
  app.post('/api/auth/logout', logoutHandler);
  app.get('/api/auth/me',      meHandler);

  // ── Protected API routes ──────────────────────────────────────────────────
  app.use('/api/settings', requireAuth, settingsRouter);
  app.use('/api/tags',     requireAuth, tagsRouter);
  app.use('/api/events',   requireAuth, eventsRouter);
  app.use('/api/loops',       requireAuth, loopsRouter);
  app.use('/api/checkpoints', requireAuth, checkpointsRouter);
  app.use('/api/override',   requireAuth, createOverrideRouter(driver));
  app.use('/api/sim',        requireAuth, createSimRouter(driver));
  app.use('/api/recording',  requireAuth, createRecordingRouter(recordingService, broadcastRecordingStatus));
  app.use('/api/calibration', requireAuth, createCalibrationRouter(calibrationService));

  // ── Static client files ───────────────────────────────────────────────────
  const clientDist = path.join(__dirname, '..', '..', 'public');
  app.use(express.static(clientDist));

  // Catch-all: serve SPA index.html for any unknown route
  app.get('*', (_req, res) => {
    const indexPath = path.join(clientDist, 'index.html');
    res.sendFile(indexPath, (err) => {
      if (err) {
        // In dev mode, the client is served by Vite — just 404
        res.status(404).send('Not found (run npm run build to generate client dist)');
      }
    });
  });

  return app;
}
