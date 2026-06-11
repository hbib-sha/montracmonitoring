# Montrac Shuttle Monitoring System — Project Plan

## Context

The Montrac Shuttle Monitoring System is a dashboard, override controller, and
per-loop crash monitor for a 3-loop shuttle track. Shuttles do **not** report
position; the PLC only knows a shuttle is present at a few checkpoints (IRM
modules + positioning sensors). The system therefore maintains **virtual
shuttles** synchronized to the real hardware via OPC UA tag reads, and infers
crashes from timing (a shuttle that doesn't arrive at the next checkpoint within
an expected window + a modifiable buffer has crashed).

The working directory currently has only [test-web-opc.js](test-web-opc.js) (a
proof-of-concept that writes the `LU_ARENA`/`ST_ARENA`/`RU_ARENA` boolean tags
over `ns=7;s=...` node IDs) and an installed `node_modules` containing
`node-opcua`. There is no `package.json` or app scaffold yet — this is
greenfield.

This plan delivers, in order: (1) `structure.md` documenting the agreed stack
and folder layout, (2) `hardwareLogic.md` re-stating the hardware/monitoring
logic in the user's own terms, and (3) the scaffolded Node.js + React project
implementing the server, websocket gateway, monitoring engine, simulation mode,
and dashboard.

### Confirmed decisions
- **Language:** TypeScript (backend + frontend)
- **Frontend:** React + Vite + Tailwind (SPA), SVG loop visualization
- **Database:** SQLite via `better-sqlite3` (settings + crash/event history)
- **Deployment:** Single industrial PC / kiosk, bound to `0.0.0.0` for LAN access
- **Real-time transport:** Socket.IO (auto-reconnect, rooms, typed events)
- **Scope now:** Loop 1 only (3 checkpoints), designed to extend to 3 loops

---

## Deliverable 1 — `structure.md` (to be created at repo root)

Content to write:

### Tech stack
| Layer | Choice |
|-------|--------|
| Runtime | Node.js **22 LTS** (engines `>=20`) |
| Language | TypeScript 5.x |
| Web server | Express 4 |
| Real-time | Socket.IO 4 |
| PLC | `node-opcua` (already installed) |
| Database | `better-sqlite3` (synchronous, embedded) |
| Validation | `zod` (settings + websocket payloads) |
| Auth | `express-session` + `bcryptjs` (default IMS-2 / imsystem) |
| Logging | `pino` + `pino-pretty` (dev) |
| Frontend | React 18, Vite, TypeScript, Tailwind CSS |
| FE state | Zustand (live shuttle/alarm state) |
| FE realtime | `socket.io-client` |
| FE viz | Inline SVG components |
| Tooling | `tsx` (dev run), `concurrently`, ESLint + Prettier |

### Repository layout (npm workspaces monorepo)
```
MontracMonitoringSystem/
├── package.json                # root: workspaces + dev scripts (concurrently)
├── structure.md
├── hardwareLogic.md
├── data/
│   └── montrac.db              # SQLite (gitignored), auto-created on boot
├── server/
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts            # boot: db → opc/sim driver → monitoring → http+ws
│       ├── config/
│       │   └── env.ts          # PORT, OPC endpoint, db path, defaults
│       ├── db/
│       │   ├── index.ts        # better-sqlite3 connection + migrations
│       │   ├── schema.sql      # tags, settings, checkpoints, loops, events, users
│       │   └── repositories/   # settingsRepo, tagRepo, eventRepo, userRepo
│       ├── opc/
│       │   ├── PlcDriver.ts     # interface: connect/read/write/subscribe/dispose
│       │   ├── OpcUaDriver.ts   # real node-opcua impl (from test-web-opc.js)
│       │   ├── SimulatedDriver.ts # in-memory tag store + manual override API
│       │   └── tagRegistry.ts  # logical name -> {nodeId, dataType}, from DB
│       ├── monitoring/
│       │   ├── MonitoringEngine.ts  # owns loops, tick loop, virtual shuttles
│       │   ├── Loop.ts              # ordered ring of checkpoints
│       │   ├── Checkpoint.ts        # per-type state machine (IRM-ID / IRM / sensor)
│       │   ├── VirtualShuttle.ts    # id, position, ETA, lastSeen, state
│       │   └── crashDetection.ts    # buffer-timer logic -> emits crash events
│       ├── alarm/
│       │   └── AlarmManager.ts  # progressive alarm, buzzer, light-tower blink, ack, auto-off
│       ├── ws/
│       │   ├── gateway.ts       # socket.io setup, broadcast state, command handlers
│       │   └── events.ts        # shared event-name + payload types
│       ├── http/
│       │   ├── app.ts           # express app, static serve of built client
│       │   ├── auth.ts          # login/logout/session middleware
│       │   └── routes/          # /api/settings, /api/tags, /api/override, /api/sim, /api/events
│       └── types/               # shared domain types (also imported by client)
└── client/
    ├── package.json
    ├── vite.config.ts          # dev proxy /api + /socket.io -> server
    ├── tailwind.config.ts
    ├── index.html
    └── src/
        ├── main.tsx
        ├── App.tsx             # router + auth guard
        ├── lib/
        │   ├── socket.ts       # socket.io-client singleton
        │   └── api.ts          # fetch wrappers
        ├── store/              # zustand stores: useLiveState, useAuth, useSettings
        ├── pages/
        │   ├── Login.tsx
        │   ├── Dashboard.tsx
        │   ├── Settings.tsx
        │   └── Simulation.tsx  # sim-mode override panel
        └── components/
            ├── LoopVisualizer.tsx   # SVG loop, checkpoints, virtual shuttles, red crash segment
            ├── ArenaOverride.tsx    # Left/Straight/Right (LU/ST/RU) buttons
            ├── AlarmBanner.tsx      # progressive alarm UI + Acknowledge
            ├── StatusBar.tsx        # online/light-tower, tag-readability check, mode (real/sim)
            └── CheckpointCard.tsx
```

### Mode of operation
- Boot flag selects **real** vs **simulation** mode (env var / login screen toggle,
  persisted in settings). Real mode → `OpcUaDriver`; simulation → `SimulatedDriver`.
- Both drivers implement the same `PlcDriver` interface, so the monitoring engine
  is identical in both modes. Simulation adds a `/api/sim` override surface.

### Dev / run scripts (root `package.json`)
- `npm run dev` → `concurrently` server (`tsx watch`) + client (`vite`)
- `npm run build` → build client (Vite) + compile server (tsc); server serves built client in prod
- `npm start` → run compiled server on the industrial PC

### Dependencies to add
- server: `express`, `socket.io`, `node-opcua` (present), `better-sqlite3`,
  `zod`, `express-session`, `bcryptjs`, `pino`, `pino-pretty`; dev: `typescript`,
  `tsx`, `@types/*`, `eslint`, `prettier`.
- client: `react`, `react-dom`, `react-router-dom`, `zustand`,
  `socket.io-client`; dev: `vite`, `@vitejs/plugin-react`, `tailwindcss`,
  `postcss`, `autoprefixer`, `typescript`.

---

## Deliverable 2 — `hardwareLogic.md` (to be created at repo root)

A plain re-statement of the hardware/monitoring model (user's spec, organized):

- **Track:** Montrac shuttle track, 3 loops. Most of the track runs without PLC
  control; only a few **checkpoints** can communicate with the PLC.
- **Shuttles do not report position.** The PLC only learns a shuttle is present
  when it reaches an IRM or positioning sensor.
- **Checkpoint hardware:** Intelligent Routing Modules (IRM) + positioning
  sensors, used to control **ARENAs** (track-direction switches) and a **robot
  station** (start/stop robot routine, stop/release shuttle).
- **We do NOT mimic** the ARENA control logic or robot comms. We only track
  **which shuttle is where**. Shuttles always stop at IRM checkpoints and wait
  for a GO signal.
- **Virtual shuttle:** software twin synced to hardware via tag reads. Distance
  between checkpoints and average shuttle speed are **user-modifiable** → used to
  compute expected travel time (ETA) between checkpoints.

### Loop 1 (the implemented example)
**Checkpoint 1 — IRM with shuttle-ID reader (ARENA)**
- Inputs: `IR3_AR_DET` (bool, IRM detects shuttle), `RS232_1.BYTE2` (int, shuttle ID)
- Output: `IR3_AR_GO` (bool, release shuttle)
- Logic: the **only** CP in Loop 1 that can read shuttle ID. On detect+read, if
  no virtual shuttle with that ID exists, **spawn** it. Shuttle is held here until
  GO is sent. If a virtual shuttle is *expected* at CP1 but `IR3_AR_DET` does not
  detect that ID within **buffer time 1**, a crash occurred between CP3 and CP1.

**Checkpoint 2 — positioning sensor (ARENA)**
- Input: `ARENA2_SIGNOFF` (bool; true while a shuttle sits on it; a moving
  shuttle only triggers a brief pulse)
- Logic: if no signal arrives within **buffer time 2**, a crash occurred in the
  arena between CP1 and CP2.

**Checkpoint 3 — robot station (IRM, no ID reader)**
- Input: `IR2_PU4_DET` (bool, IRM detects shuttle)
- Output: `IR2_PU4_GO` (bool, release shuttle)
- Logic: like CP1 but cannot read shuttle ID. If the virtual shuttle arrives
  before the detect signal, wait **buffer time 3** before assuming a crash.

### Crash detection summary
- Each segment between consecutive checkpoints has an expected travel time =
  distance / average speed. The relevant **buffer time** is the grace period on
  top of that ETA. Exceeding ETA + buffer with no detection ⇒ crash on that
  segment; the segment is marked red and the alarm fires.

### System behaviors (cross-cutting)
- **Online indicator:** on (real or simulated) connection, continuously **blink a
  green light-tower output** via the PLC. Tower tag address is user-defined.
- **Tag readability check** on startup for every registered address.
- **Auth:** simple login, default `IMS-2` / `imsystem`.
- **Alarm:** on crash, mark segment red + sound **buzzer** (user-defined address),
  enter **progressive alarm** mode. Alarm auto-clears after **30s** (modifiable),
  or on **Push Button 1** (user-defined address), or **Acknowledge** in the web UI.
- **Settings:** user defines all tag addresses, buffer times, distances, speeds,
  light-tower/buzzer/push-button addresses; persisted in SQLite.
- **Simulation mode:** no real PLC connection; an override dialog lets the user
  drive simulated PLC variables to reproduce real hardware behavior.

---

## Deliverable 3 — Server + client implementation plan

Build order (each step independently runnable):

1. **Scaffold & tooling** — root `package.json` workspaces, `server/` + `client/`
   tsconfigs, Tailwind, ESLint/Prettier, dev scripts. Add `.gitignore`
   (`node_modules`, `data/*.db`, `dist`, build output). Move/keep
   [test-web-opc.js](test-web-opc.js) as reference under a `reference/` folder.

2. **Database layer** — `db/schema.sql` (tables: `loops`, `checkpoints`, `tags`,
   `settings`, `events`, `users`), migrations on boot, repositories. Seed Loop 1
   checkpoints + tag rows from `test-web-opc.js` defaults and the default user.

3. **PLC driver abstraction** — `PlcDriver` interface; `OpcUaDriver` lifted from
   the proven connect/session/bulk-write pattern in `test-web-opc.js` plus
   read/subscribe; `SimulatedDriver` with in-memory tag map + override setter.
   `tagRegistry` resolves logical names → `{nodeId, dataType}` from DB.

4. **Monitoring engine** — `Loop`/`Checkpoint`/`VirtualShuttle`, the tick loop
   that polls/subscribes inputs, spawns shuttles at CP1, advances ETAs, and runs
   `crashDetection` per segment. Emits `shuttleUpdate` and `crash` events.

5. **Alarm manager** — light-tower blink interval on connect; on `crash` →
   buzzer on + progressive alarm; auto-off timer, push-button input, and
   `acknowledge` command all clear it.

6. **HTTP + Auth + WebSocket** — Express app, session login, settings/tags/
   override/sim/events routes; Socket.IO gateway broadcasting live state and
   accepting `arenaOverride`, `acknowledgeAlarm`, `simSetTag` commands.

7. **Frontend** — auth guard + login; Dashboard (`LoopVisualizer`,
   `ArenaOverride`, `AlarmBanner`, `StatusBar`); Settings editor; Simulation
   override panel (visible only in sim mode). Zustand store fed by socket events.

8. **Wire-up & polish** — startup tag-readability report, mode toggle, industrial
   visual styling (dark/high-contrast, large touch targets).

### Reuse from existing code
- OPC connect + bulk boolean write pattern: [test-web-opc.js:116-138](test-web-opc.js#L116-L138)
- Arena direction → LU/ST/RU boolean mapping: [test-web-opc.js:105-110](test-web-opc.js#L105-L110)
- Node ID / `ns=7;s=...` tag format + endpoint: [test-web-opc.js:11-17](test-web-opc.js#L11-L17)
- Connection strategy options: [test-web-opc.js:163-172](test-web-opc.js#L163-L172)

---

## Verification

- **Build:** `npm install` at root then `npm run dev` starts server + Vite;
  `npm run build && npm start` produces a single served app.
- **Simulation mode (no PLC needed):** start in sim mode, open dashboard, confirm
  green light-tower indicator blinks, virtual shuttle spawns at CP1. Use the
  Simulation panel to:
  - toggle `IR3_AR_DET` + set `RS232_1.BYTE2` → shuttle spawns/advances;
  - withhold `ARENA2_SIGNOFF` past buffer time 2 → CP1→CP2 segment turns red,
    buzzer flag set, alarm banner appears;
  - clear via Acknowledge, auto-off timer, and simulated Push Button 1.
- **Override:** click Left/Straight/Right → assert correct LU/ST/RU booleans sent
  to the driver (verify against `SimulatedDriver` tag store, or real PLC).
- **Real mode:** point OPC endpoint at the PLC (or the `10.0.2.2:4845` test
  endpoint), confirm startup tag-readability report and that arena override
  writes land (reuses the verified `test-web-opc.js` write path).
- **Persistence:** change a tag address / buffer time in Settings, restart,
  confirm it persisted in `data/montrac.db`.

## Notes / future
- Loops 2 and 3: add rows to `loops`/`checkpoints` + `LoopVisualizer` instances;
  the engine is loop-count agnostic.
