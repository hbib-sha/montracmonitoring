/**
 * WebSocket Gateway — Socket.IO server.
 * Bridges the monitoring engine and alarm manager to connected clients.
 */
import type { Server as HttpServer } from 'http';
import { Server as IoServer } from 'socket.io';
import type {
  ServerToClientEvents,
  ClientToServerEvents,
  InterServerEvents,
  SocketData,
} from './events';
import type { MonitoringEngine } from '../monitoring/MonitoringEngine';
import type { AlarmManager } from '../alarm/AlarmManager';
import type { PlcDriver } from '../opc/PlcDriver';
import { SimulatedDriver } from '../opc/SimulatedDriver';
import { tagRegistry } from '../opc/tagRegistry';
import { eventRepo } from '../db/repositories/eventRepo';
import type { SystemState, PlcMode } from '../types';
import pino from 'pino';

const logger = pino({ name: 'WsGateway' });

type IoType = IoServer<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

export function createGateway(
  httpServer: HttpServer,
  engine: MonitoringEngine,
  alarmManager: AlarmManager,
  driver: PlcDriver,
  getMode: () => PlcMode,
  isConnected: () => boolean,
  tagCheckResults: () => Record<string, boolean>,
): IoType {
  const io: IoType = new IoServer(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
  });

  // ── Broadcast helpers ───────────────────────────────────────────────────
  function buildSystemState(): SystemState {
    return {
      mode:            getMode(),
      connected:       isConnected(),
      tagCheckResults: tagCheckResults(),
      loops:           engine.getLoops().map((l) => l.toState()),
      alarm:           alarmManager.getState(),
    };
  }

  function broadcastState(): void {
    io.emit('systemState', buildSystemState());
  }

  function broadcastAlarm(): void {
    io.emit('alarmUpdate', alarmManager.getState());
  }

  // ── Engine / alarm event wiring ─────────────────────────────────────────
  engine.on('stateChanged', broadcastState);

  engine.on('crash', (payload) => {
    alarmManager.onCrash(payload);
    eventRepo.create(payload.loopId, payload.fromIndex, payload.toIndex);
    broadcastState();
  });

  alarmManager.on('alarmChanged', () => {
    broadcastAlarm();
    broadcastState();
  });

  // Sim tag changes → broadcast to clients
  if (driver instanceof SimulatedDriver) {
    driver.on('tagChanged', () => {
      io.emit('simTags', driver.getAll());
    });
  }

  // ── Connection handler ──────────────────────────────────────────────────
  io.on('connection', (socket) => {
    logger.info({ id: socket.id }, 'Client connected');

    // Send full state immediately
    socket.emit('systemState', buildSystemState());
    if (driver instanceof SimulatedDriver) {
      socket.emit('simTags', driver.getAll());
    }

    // ── Arena override ────────────────────────────────────────────────────
    socket.on('arenaOverride', async (payload) => {
      const { direction, lu_node_id, st_node_id, ru_node_id } = payload;
      if (!lu_node_id || !st_node_id || !ru_node_id) {
        logger.warn({ payload }, 'arenaOverride: missing node IDs — ignoring');
        return;
      }
      const lu = direction === 'left';
      const st = direction === 'straight';
      const ru = direction === 'right';
      logger.info({ direction }, 'Arena override');
      await driver.writeMany([
        { nodeId: lu_node_id, value: lu },
        { nodeId: st_node_id, value: st },
        { nodeId: ru_node_id, value: ru },
      ]);
    });

    // ── GO signal ─────────────────────────────────────────────────────────
    socket.on('sendGo', async ({ checkpointId }) => {
      logger.info({ checkpointId }, 'Send GO');
      await engine.sendGo(checkpointId);
      broadcastState();
    });

    // ── Alarm acknowledge ─────────────────────────────────────────────────
    socket.on('acknowledgeAlarm', () => {
      logger.info('Alarm acknowledged via web');
      // Capture loopId BEFORE acknowledge() clears alarm state
      const loopId = alarmManager.getState().loopId;
      alarmManager.acknowledge();
      if (loopId !== undefined) engine.clearCrashes(loopId);
      eventRepo.acknowledgeAll();
      broadcastState();
    });

    // ── Stop loop (reset + despawn) ───────────────────────────────────────
    socket.on('stopLoop', ({ loopId }) => {
      logger.info({ loopId }, 'Stop loop — resetting virtual shuttles');
      engine.resetLoop(loopId);
      broadcastState();
    });

    // ── Simulation tag override ───────────────────────────────────────────
    socket.on('simSetTag', ({ logicalName, value }) => {
      if (!(driver instanceof SimulatedDriver)) return;
      const tag = tagRegistry.getByName(logicalName);
      if (!tag) {
        logger.warn({ logicalName }, 'simSetTag: unknown tag');
        return;
      }
      driver.setTag(tag.nodeId, value);
      io.emit('simTags', driver.getAll());
    });

    socket.on('disconnect', () => {
      logger.info({ id: socket.id }, 'Client disconnected');
    });
  });

  return io;
}
