import { io, type Socket } from 'socket.io-client';
import type {
  ServerToClientEvents,
  ClientToServerEvents,
} from '../../../server/src/ws/events';

// In production the client is served by the same server.
// In dev, vite.config.ts proxies /socket.io → server:3000.
export const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io({
  autoConnect: true,
  reconnectionDelay: 1000,
  reconnectionAttempts: Infinity,
});
