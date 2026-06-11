# Montrac Shuttle Monitoring System — Project Structure

## Tech Stack

| Layer | Choice | Reason |
|-------|--------|--------|
| Runtime | Node.js **22 LTS** (`engines >=20`) | Current LTS, native ESM, best perf for I/O-heavy OPC UA polling |
| Language | TypeScript 5.x | Type safety for tag maps, shuttle state machines, WS message contracts |
| Web server | Express 4 | Mature, minimal, pairs well with Socket.IO |
| Real-time | Socket.IO 4 | Auto-reconnect, typed events, rooms; ideal for live PLC state broadcast |
| PLC comms | `node-opcua` (already installed) | Proven in `test-web-opc.js`; bulk read/write, subscriptions |
| Database | `better-sqlite3` | Synchronous embedded SQLite; zero config on industrial PC |
| Validation | `zod` | Runtime safety for settings, API payloads, WS events |
| Auth | `express-session` + `bcryptjs` | Simple session auth; default `IMS-2` / `imsystem` |
| Logging | `pino` + `pino-pretty` (dev) | Structured, fast, low overhead |
| Frontend framework | React 18 + Vite | SPA, hot reload, fast builds |
| Frontend language | TypeScript | Shared types with server |
| Frontend styling | Tailwind CSS | Utility-first; industrial dark theme |
| Frontend state | Zustand | Minimal, reactive, no boilerplate |
| Frontend realtime | `socket.io-client` | Mirrors server Socket.IO |
| Frontend viz | Inline SVG components | Loop track + shuttle position rendering |
| Tooling | `tsx` (dev server), `concurrently`, ESLint, Prettier | DX: hot-reload server + Vite in one command |

---

## Repository Layout

```
MontracMonitoringSystem/
│
├── package.json               # Root: npm workspaces ["server","client"], shared dev scripts
├── .gitignore
├── structure.md               # ← this file
├── hardwareLogic.md           # Hardware/monitoring design reference
│
├── reference/
│   └── test-web-opc.js        # Original OPC UA PoC (preserved for reference)
│
├── data/                      # Runtime data (gitignored)
│   └── montrac.db             # SQLite database (auto-created on first boot)
│
├── server/
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts           # Entry point: db → driver → engine → http+ws
│       │
│       ├── config/
│       │   └── env.ts         # PORT, OPC_ENDPOINT, DB_PATH, MODE defaults
│       │
│       ├── db/
│       │   ├── index.ts       # better-sqlite3 open + run migrations
│       │   ├── schema.sql     # CREATE TABLE: loops, checkpoints, tags,
│       │   │                  #   settings, events, users
│       │   └── repositories/
│       │       ├── settingsRepo.ts
│       │       ├── tagRepo.ts
│       │       ├── eventRepo.ts
│       │       └── userRepo.ts
│       │
│       ├── opc/
│       │   ├── PlcDriver.ts        # interface: connect/read/write/subscribe/dispose
│       │   ├── OpcUaDriver.ts      # Real node-opcua impl (lifted from test-web-opc.js)
│       │   ├── SimulatedDriver.ts  # In-memory tag store + override setter
│       │   └── tagRegistry.ts     # Logical name → { nodeId, dataType } (from DB)
│       │
│       ├── monitoring/
│       │   ├── MonitoringEngine.ts # Owns all loops; main poll/tick interval
│       │   ├── Loop.ts             # Ordered ring of checkpoints
│       │   ├── Checkpoint.ts       # Per-type state machine: IRM-ID | IRM | sensor
│       │   ├── VirtualShuttle.ts   # id, position, eta, lastSeen, status
│       │   └── crashDetection.ts   # ETA+buffer timer logic → emits crash events
│       │
│       ├── alarm/
│       │   └── AlarmManager.ts    # Light-tower blink, buzzer, progressive alarm,
│       │                          #   auto-off (30s), push-button poll, ack command
│       │
│       ├── ws/
│       │   ├── gateway.ts         # Socket.IO server, broadcast helpers
│       │   └── events.ts          # Shared event names + TypeScript payload types
│       │
│       ├── http/
│       │   ├── app.ts             # Express app, static serve of built client
│       │   ├── auth.ts            # Login/logout, requireAuth middleware
│       │   └── routes/
│       │       ├── settings.ts    # GET/PUT /api/settings
│       │       ├── tags.ts        # GET/PUT /api/tags
│       │       ├── override.ts    # POST /api/override (arena direction)
│       │       ├── sim.ts         # POST /api/sim/tag (simulation override)
│       │       └── events.ts      # GET /api/events (crash history)
│       │
│       └── types/
│           └── index.ts           # Shared domain types (Loop, Checkpoint, Shuttle,
│                                  #   AlarmState, TagDef, Settings) — also used by client
│
└── client/
    ├── package.json
    ├── tsconfig.json
    ├── vite.config.ts             # Dev proxy: /api + /socket.io → server :3000
    ├── tailwind.config.ts
    ├── postcss.config.js
    ├── index.html
    └── src/
        ├── main.tsx
        ├── App.tsx                # React Router + auth guard
        │
        ├── lib/
        │   ├── socket.ts          # socket.io-client singleton
        │   └── api.ts             # Typed fetch wrappers for REST routes
        │
        ├── store/
        │   ├── useLiveState.ts    # Zustand: loops, shuttles, alarms (from WS)
        │   ├── useAuth.ts         # Zustand: session user, login/logout
        │   └── useSettings.ts     # Zustand: settings + tag config (from REST)
        │
        ├── pages/
        │   ├── Login.tsx          # Fullscreen login form
        │   ├── Dashboard.tsx      # Main operator view
        │   ├── Settings.tsx       # Tag addresses, buffer times, distances, speeds
        │   └── Simulation.tsx     # Sim-mode override panel (hidden in real mode)
        │
        └── components/
            ├── LoopVisualizer.tsx  # SVG loop track: checkpoints, shuttles, red segments
            ├── ArenaOverride.tsx   # Left / Straight / Right buttons (LU/ST/RU)
            ├── AlarmBanner.tsx     # Progressive alarm UI + Acknowledge button
            ├── StatusBar.tsx       # Online indicator, mode (real/sim), tag-check status
            └── CheckpointCard.tsx  # Checkpoint detail: detect, id, go signal state
```

---

## Mode of Operation

| Mode | PLC Driver | Simulation Panel |
|------|-----------|-----------------|
| **Real** | `OpcUaDriver` — connects to PLC via OPC UA | Hidden |
| **Simulation** | `SimulatedDriver` — in-memory tag map | Visible (override any tag) |

Mode is selected on the login screen and persisted in the `settings` table. Both
drivers implement the same `PlcDriver` interface, so the monitoring engine,
alarm manager, and WebSocket gateway are **identical** in both modes.

---

## Dev / Run Scripts

### Root `package.json` workspaces scripts
| Command | What it does |
|---------|-------------|
| `npm run dev` | `concurrently`: `tsx watch` server + `vite` client (with proxy) |
| `npm run build` | `vite build` (client) then `tsc -p server/tsconfig.json` |
| `npm start` | `node server/dist/index.js` (production, serves built client) |
| `npm run lint` | ESLint across both workspaces |

### First-time setup
```sh
node --version   # must be >= 20
npm install      # installs all workspace deps
npm run dev      # http://localhost:3000
```

---

## Key Dependencies

### Server (`server/package.json`)

| Package | Purpose |
|---------|---------|
| `express` | HTTP server |
| `socket.io` | WebSocket gateway |
| `node-opcua` | OPC UA client (already in root node_modules) |
| `better-sqlite3` | Embedded SQLite |
| `zod` | Schema validation |
| `express-session` | Session management |
| `bcryptjs` | Password hashing |
| `pino`, `pino-pretty` | Structured logging |
| `typescript`, `tsx` | TS compilation + dev runner |
| `@types/express`, `@types/better-sqlite3`, `@types/bcryptjs`, `@types/express-session` | Type definitions |

### Client (`client/package.json`)

| Package | Purpose |
|---------|---------|
| `react`, `react-dom` | UI framework |
| `react-router-dom` | SPA routing |
| `zustand` | Lightweight state management |
| `socket.io-client` | Real-time WS connection |
| `vite`, `@vitejs/plugin-react` | Build tooling |
| `tailwindcss`, `postcss`, `autoprefixer` | Styling |
| `typescript` | Type checking |

---

## Data Flow Summary

```
PLC (OPC UA)
    ↓  read/subscribe (100ms poll)
PlcDriver (OpcUaDriver | SimulatedDriver)
    ↓
tagRegistry  (nodeId lookup from SQLite)
    ↓
MonitoringEngine  →  Loop(s)  →  Checkpoint state machines
                               →  VirtualShuttle positions
                               →  crashDetection (ETA + buffer timers)
    ↓ crash event
AlarmManager  →  buzzer write / light-tower blink / auto-off timer
    ↓ all state changes
Socket.IO gateway  →  broadcast to all connected clients
    ↓
React Dashboard (Zustand store ← socket events)
    ↑
User actions (arena override, acknowledge, sim override)
    → POST /api/...  →  PlcDriver.write() or SimulatedDriver.set()
```

---

## Future Extensions

- **Loop 2 & 3:** Add rows to `loops` + `checkpoints` tables; add a
  `LoopVisualizer` instance per loop on the Dashboard. Engine is loop-count
  agnostic.
- **Multi-client LAN:** Socket.IO already broadcasts to all connections;
  add override-lock if needed.
- **Event history view:** `events` table already stores crash records; a
  history page can query `/api/events`.
