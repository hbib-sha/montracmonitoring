# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development (runs server + client concurrently in watch mode)
npm run dev

# Production build
npm run build
npm start

# Lint both workspaces
npm run lint

# Workspace-scoped commands
npm run dev --workspace=server
npm run dev --workspace=client
npm run build --workspace=server
npm run build --workspace=client
```

There are no automated tests. The system is verified manually using the simulation panel (SimulatedDriver + UI).

Default credentials: **IMS-2 / imsystem**

## Architecture

This is a browser-based SCADA dashboard for tracking virtual shuttles on a Montrac conveyor track ring via OPC UA. It is a Node.js/React monorepo:

```
server/   TypeScript backend (Express + Socket.IO)
client/   React/Vite frontend
data/     SQLite database (auto-created, gitignored)
```

### Core monitoring loop (200ms poll cycle)

`MonitoringEngine` → `Loop` → `Checkpoint` → `VirtualShuttle`

1. `MonitoringEngine.tick()` reads all input tags from the PLC driver (real or simulated) every 200ms.
2. The snapshot is passed to each `Loop.tick(snapshot)`.
3. `Checkpoint.updateFromSnapshot()` detects rising edges on arrival/GO signals.
4. On arrival events, shuttles are spawned or advanced; ETAs are calculated from distance ÷ average speed + a configurable buffer.
5. `crashDetection.ts` fires per-segment overdue timers; a miss emits a crash event → `AlarmManager` triggers the light tower/buzzer.

### PLC abstraction

`PlcDriver` (interface) has two implementations:
- `OpcUaDriver` — real PLC via `node-opcua`
- `SimulatedDriver` — in-memory tag store; the UI simulation panel writes to this

The driver is selected at boot based on whether `OPC_ENDPOINT` resolves. The system boots and continues operating if the PLC is unreachable (dashboard shows disconnected status).

### Data flow to the browser

`MonitoringEngine` and `AlarmManager` emit events → `ws/gateway.ts` broadcasts via Socket.IO:
- `systemState` — full loop/shuttle/checkpoint snapshot
- `alarmUpdate` — crash/acknowledge state
- `simTags` — current simulated tag values

The client uses Zustand stores (`useLiveState`, `useSettings`, `useAuth`) to consume REST API + WebSocket data.

### Database

SQLite at `data/montrac.db`, auto-created on first boot. Key tables:
- `tags` — OPC UA tag definitions (logical_name, node_id, direction, data_type)
- `loops` — Ring definitions with `allowed_shuttle_ids` (JSON array)
- `checkpoints` — Ring positions with type (`IRM_ID`, `IRM`, `SENSOR`), distances, and timing buffers
- `events` — Crash/alarm log with acknowledged timestamps
- `settings` — Global key/value config (speed, buffers, etc.)

### Checkpoint types

- `IRM_ID` — detects shuttle ID (spawns a new virtual shuttle with a known ID)
- `IRM` — detects shuttle presence only (advances existing shuttle)
- `SENSOR` — photocell/limit switch (used for GO-signal logic)

### Loop configuration

Adding a new loop requires **no code changes** — it is pure database configuration: insert a `loops` row, `checkpoints` rows with correct sequence/type, and `tags` rows with OPC UA node IDs. The monitoring engine auto-discovers all loops from the DB at boot.

## Key files

| File | Purpose |
|---|---|
| `server/src/monitoring/MonitoringEngine.ts` | Orchestrates all loops, owns the 200ms tick |
| `server/src/monitoring/Loop.ts` | Per-ring state: checkpoints, virtual shuttles, arena override |
| `server/src/monitoring/Checkpoint.ts` | Per-checkpoint rising-edge detection, GO logic |
| `server/src/monitoring/VirtualShuttle.ts` | Shuttle object (id, position, status, ETA) |
| `server/src/monitoring/crashDetection.ts` | Per-segment overdue timers |
| `server/src/alarm/AlarmManager.ts` | Light tower, buzzer, push-button poll |
| `server/src/opc/SimulatedDriver.ts` | In-memory tag store for dev/testing |
| `server/src/ws/gateway.ts` | Socket.IO bridge between engine and clients |
| `server/src/ws/events.ts` | Typed event contracts (ServerToClient, ClientToServer) |
| `server/src/db/schema.sql` | Full DB schema |
| `client/src/store/useLiveState.ts` | Zustand: WebSocket system state |
| `client/src/components/LoopVisualizer.tsx` | SVG ring diagram with rAF animation |

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | 3000 | HTTP server port |
| `OPC_ENDPOINT` | — | OPC UA endpoint URL; omit to use SimulatedDriver |
| `DB_PATH` | `data/montrac.db` | SQLite database path |
| `SESSION_SECRET` | — | Express session secret |
