# Montrac Monitoring System

A browser-based SCADA-style dashboard for tracking virtual shuttles on a Montrac shuttle track via OPC UA. The server maintains **virtual shuttles** — software twins synchronized to physical hardware — and infers crashes from per-segment timing when a shuttle fails to arrive within its ETA plus a configurable buffer.

## Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 22 LTS |
| Language | TypeScript |
| Server | Express + Socket.IO |
| Client | React + Vite + Tailwind CSS |
| Database | `node:sqlite` (built-in to Node 22) |
| OPC UA | `node-opcua` |

## Prerequisites

- Node.js 22 LTS
- npm 10+

## Getting started

```bash
npm install
npm run dev
```

The server starts on `http://localhost:3000` by default. Both server and client are started concurrently.

**Default credentials:** `IMS-2` / `imsystem`

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP server port |
| `OPC_ENDPOINT` | `opc.tcp://10.0.2.2:4845` | OPC UA server endpoint |
| `DB_PATH` | `data/montrac.db` | SQLite database file path |
| `SESSION_SECRET` | *(built-in default)* | Express session secret |

Set these in a `.env` file at the repo root (gitignored).

## Project structure

```
MontracMonitoringSystem/
├── server/src/
│   ├── index.ts                    Boot sequence (DB → driver → engine → HTTP → WS)
│   ├── config/env.ts               Port, OPC endpoint, poll interval
│   ├── db/
│   │   ├── schema.sql              Tables: users, settings, tags, loops, checkpoints, events
│   │   └── index.ts                initDb() + seedDefaultsIfEmpty()
│   ├── opc/
│   │   ├── PlcDriver.ts            Interface (connect/read/write/dispose)
│   │   ├── OpcUaDriver.ts          Real PLC via node-opcua
│   │   └── SimulatedDriver.ts      In-memory tag store for development
│   ├── monitoring/
│   │   ├── MonitoringEngine.ts     Orchestrates all loops; tick loop; sendGo/resetLoop
│   │   ├── Loop.ts                 Ring of checkpoints, virtual shuttles, crash detection
│   │   ├── Checkpoint.ts           Per-checkpoint state machine (armed/goEdge model)
│   │   ├── VirtualShuttle.ts       id, checkpointIndex, status, movedAtMs, etaMs
│   │   └── crashDetection.ts       Per-segment overdue timers → emits crash event
│   ├── alarm/AlarmManager.ts       Light-tower blink, buzzer, auto-off, push-button poll
│   ├── ws/
│   │   ├── gateway.ts              Socket.IO; bridges engine + alarm to clients
│   │   └── events.ts               Typed event contracts (ServerToClient, ClientToServer)
│   └── http/
│       ├── app.ts                  Express app; registers all routes
│       └── routes/                 settings, tags, loops, checkpoints, override, sim, events
└── client/src/
    ├── App.tsx                     Router (/, /login, /settings)
    ├── pages/
    │   ├── Dashboard.tsx           Main view with SimulationDialog overlay
    │   ├── Login.tsx
    │   └── Settings.tsx            System config + per-loop checkpoint tuning
    ├── components/
    │   ├── LoopVisualizer.tsx      SVG loop diagram; rAF animation; Stop button
    │   ├── CheckpointCard.tsx      Per-checkpoint detect indicator + GO button
    │   ├── ArenaOverride.tsx       L/S/R direction buttons (one per loop)
    │   ├── AlarmBanner.tsx         Crash alert + Acknowledge
    │   ├── StatusBar.tsx           WS/PLC status, mode badge, tag-check warnings
    │   └── SimulationDialog.tsx    Draggable overlay; input overrides + live outputs
    └── store/
        ├── useLiveState.ts         Zustand; systemState + simTags from socket
        ├── useSettings.ts          Zustand; settings + tags from REST
        └── useAuth.ts              Zustand; session check/login/logout
```

## Modes

### Simulation mode

Set `mode = simulation` via the Settings page (no server restart required). The `SimulatedDriver` replaces the real OPC UA driver; all tag reads/writes operate against an in-memory store. Open the **Sim Panel** overlay from the dashboard to manually set input tags and observe output tags live.

### Real (OPC UA) mode

Set `mode = opcua` in Settings and provide the correct `OPC_ENDPOINT`. The server will connect to the PLC on next boot.

## How the monitoring engine works

```
MonitoringEngine.tick()  (every 200 ms)
  → driver.readMany(allInputNodeIds)
  → Loop.tick(snapshot)
      → Checkpoint.updateFromSnapshot()   ← armed model: arrival + GO edges
      → arrivalEdge → handleArrival()
            IRM_ID  → find/spawn shuttle by ID, arriveAt(idx)
            IRM     → popExpectedShuttle ?? findAnyShuttleInLoop, arriveAt(idx)
            SENSOR  → findMovingShuttleFor(prevIdx), advance + new timer
      → goEdge → handleGo()
            find stopped shuttle at idx, depart(eta), startTracking timer
```

Crash timer fires → `CrashDetector` emits `crash` → `Loop` marks segment red + marks shuttle crashed → `MonitoringEngine` emits `crash` → `AlarmManager.onCrash` + event log + WebSocket broadcast.

## Key features

- **Virtual shuttle tracking** — infers shuttle position from IRM/sensor arrival events without requiring continuous position telemetry
- **Crash detection** — per-segment timers; configurable ETA (derived from distance ÷ average speed) + buffer per checkpoint
- **Stop loop** — resets a loop instantly, despawning all virtual shuttles and cancelling crash timers; the system re-syncs on the next arrival event
- **Crash acknowledge + recovery** — crashed shuttles resume moving with a fresh buffer window; a new crash fires if they still don't arrive
- **Simulation panel** — draggable overlay for manual tag injection; GO pulses, arena direction, light-tower, and buzzer all update live
- **Settings UI** — per-checkpoint distance and crash buffer editable at runtime; arena override; loop configuration

## Adding a new loop

The engine, database schema, and frontend are loop-count-agnostic. See [`handoff1.md`](handoff1.md) for the step-by-step data + tag procedure — no engine code changes required.

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start server + client in watch mode |
| `npm run build` | Build both workspaces for production |
| `npm start` | Run production build (`server/dist/index.js`) |
| `npm run lint` | ESLint both workspaces |

## Database

SQLite database is auto-created at `data/montrac.db` on first boot and seeded with default Loop 1 configuration. The `data/` directory is gitignored. Delete `montrac.db` to reset all configuration to defaults.
