/**
 * Montrac Monitoring System — Server entry point
 *
 * Boot sequence:
 *  1.  Initialise SQLite database (schema + seed)
 *  2.  Load settings from DB
 *  3.  Create PLC driver (real or simulation)
 *  4.  Connect to PLC / initialise sim
 *  5.  Run startup tag-readability check
 *  6.  Start monitoring engine
 *  7.  Start alarm manager (light tower, push button poll)
 *  8.  Create recording service
 *  9.  Create Express app + HTTP server
 *  10. Create Socket.IO gateway
 *  11. Start listening
 */
import http from 'http';
import pino from 'pino';
import pretty from 'pino-pretty';
import { initDb } from './db/index';
import { tagRegistry } from './opc/tagRegistry';
import { settingsRepo } from './db/repositories/settingsRepo';
import { OpcUaDriver } from './opc/OpcUaDriver';
import { SimulatedDriver } from './opc/SimulatedDriver';
import { MonitoringEngine } from './monitoring/MonitoringEngine';
import { AlarmManager } from './alarm/AlarmManager';
import { RecordingService } from './recording/RecordingService';
import { createApp } from './http/app';
import { createGateway } from './ws/gateway';
import { config as envConfig } from './config/env';
import type { PlcDriver } from './opc/PlcDriver';
import type { SystemState } from './types';

const logger = pino(pretty({ colorize: true }));
logger.info('=== Montrac Monitoring System booting ===');

// ─── 1. Database ─────────────────────────────────────────────────────────────
initDb();
logger.info('Database ready');

// ─── 2. Settings ─────────────────────────────────────────────────────────────
const settings = settingsRepo.getAll();
logger.info({ mode: settings.mode, endpoint: settings.opcEndpoint }, 'Settings loaded');

// ─── 3. Tag registry ─────────────────────────────────────────────────────────
tagRegistry.reload();
const allTags = tagRegistry.getAll();
logger.info({ count: allTags.length }, 'Tags loaded');

// ─── 4. PLC Driver ───────────────────────────────────────────────────────────
let driver: PlcDriver;
if (settings.mode === 'real') {
  driver = new OpcUaDriver(settings.opcEndpoint);
} else {
  driver = new SimulatedDriver();
}

// ─── 5. Monitoring Engine ────────────────────────────────────────────────────
const engine = new MonitoringEngine(
  driver,
  envConfig.pollIntervalMs,
  settings.avgSpeedMmPerSec,
);

// ─── 6. Alarm Manager ────────────────────────────────────────────────────────
const alarmManager = new AlarmManager(driver, {
  alarmAutoOffMs:    settings.alarmAutoOffMs,
  lightTowerNodeId:  settings.lightTowerNodeId,
  buzzerNodeId:      settings.buzzerNodeId,
  pushButton1NodeId: settings.pushButton1NodeId,
  lightTowerBlinkMs: envConfig.lightTowerBlinkMs,
});

// ─── 7. Tag check results (shared mutable state) ─────────────────────────────
const tagCheckResults: Record<string, boolean> = {};

// ─── 8. Recording Service ────────────────────────────────────────────────────
// buildSystemState mirrors gateway.ts — both use the same live references.
function buildSystemState(): SystemState {
  return {
    mode:            settings.mode,
    connected:       driver.isConnected,
    tagCheckResults: { ...tagCheckResults },
    loops:           engine.getLoops().map((l) => l.toState()),
    alarm:           alarmManager.getState(),
  };
}

// Mutable broadcast stub — replaced once the gateway is created.
// The app captures it via a closure so the real function is always called.
let broadcastRecordingStatus: () => void = () => {};

const recordingService = new RecordingService(engine, buildSystemState);

// ─── 9. Express + HTTP ───────────────────────────────────────────────────────
const app        = createApp(driver, recordingService, () => broadcastRecordingStatus());
const httpServer = http.createServer(app);

// ─── 10. Socket.IO Gateway ───────────────────────────────────────────────────
const { broadcastRecordingStatus: gatewayBroadcast } = createGateway(
  httpServer,
  engine,
  alarmManager,
  driver,
  () => settings.mode,
  () => driver.isConnected,
  () => ({ ...tagCheckResults }),
  recordingService,
);

// Wire up the real broadcast now that the gateway (and io) exist
broadcastRecordingStatus = gatewayBroadcast;

// ─── 11. Boot sequence ────────────────────────────────────────────────────────
async function boot(): Promise<void> {
  try {
    logger.info('Connecting to PLC driver...');
    await driver.connect();
    logger.info({ mode: settings.mode }, '✓ Driver connected');

    // Startup tag-readability check
    logger.info('Running tag readability check...');
    const readableTags = allTags.filter((t) => t.direction !== 'write');
    const inputNodeIds = readableTags.map((t) => t.nodeId);
    const values = await driver.readMany(inputNodeIds);
    for (const tag of allTags) {
      // Write-only tags are not checked — mark as OK by convention
      tagCheckResults[tag.logicalName] =
        tag.direction === 'write' ? true : tag.nodeId in values;
    }
    const badCount = Object.values(tagCheckResults).filter((v) => !v).length;
    logger.info({ ok: allTags.length - badCount, bad: badCount }, 'Tag check complete');

    // Start monitoring
    engine.start();
    logger.info('✓ Monitoring engine started');

    // Start alarm (light tower blink, push button poll)
    alarmManager.startOnlineIndicator();
    logger.info('✓ Alarm manager online');

  } catch (err) {
    logger.error({ err }, 'PLC connection failed — continuing anyway');
    // System still boots; dashboard will show disconnected status
  }

  // Start HTTP server regardless of PLC status
  httpServer.listen(envConfig.port, '0.0.0.0', () => {
    logger.info('=========================================');
    logger.info(`✓ Server running on http://localhost:${envConfig.port}`);
    logger.info(`  Mode: ${settings.mode.toUpperCase()}`);
    logger.info('=========================================');
  });
}

// Graceful shutdown
process.on('SIGINT', async () => {
  logger.info('Shutting down...');
  recordingService.stop();
  alarmManager.stopAll();
  engine.stop();
  await driver.dispose();
  process.exit(0);
});

boot().catch((err) => {
  logger.error({ err }, 'Fatal boot error');
  process.exit(1);
});
