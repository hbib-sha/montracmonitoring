import path from 'path';

const root = path.resolve(__dirname, '..', '..', '..');

export const config = {
  port: parseInt(process.env.PORT ?? '3000', 10),
  opcEndpoint: process.env.OPC_ENDPOINT ?? 'opc.tcp://10.0.2.2:4845',
  dbPath: process.env.DB_PATH ?? path.join(root, 'data', 'montrac.db'),
  sessionSecret: process.env.SESSION_SECRET ?? 'montrac-ims-secret-2024',
  defaultUsername: 'IMS-2',
  defaultPassword: 'imsystem',
  pollIntervalMs: 200,       // OPC tag poll rate
  lightTowerBlinkMs: 1000,   // light tower blink interval
} as const;
