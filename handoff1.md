# Montrac Monitoring System — Handoff 1

**Date:** 2026-06-11  
**Status:** Loop 1 fully functional in simulation mode. All four originally-reported
problems fixed. Loop-count-agnostic engine is ready for Loop 2 and Loop 3.

---

## What is this system

A browser-based SCADA-style dashboard that tracks virtual shuttles on a Montrac
shuttle track via OPC UA tag reads. Shuttles do not report position; the PLC only
signals presence at a few checkpoints (IRM modules + positioning sensors). The
server maintains **virtual shuttles** — software twins synchronized to the hardware
— and infers crashes from timing (shuttle didn't arrive within ETA + buffer).

Runtime: Node 22 LTS, TypeScript. Monorepo: `server/` (Express + Socket.IO) and
`client/` (React + Vite + Tailwind). DB: node:sqlite (built-in to Node 22).
OPC UA: `node-opcua`.

Start with `npm run dev` from the repo root (requires `node_modules` already
installed — run `npm install` first if needed).

---

## Repository layout (key files only)

```
MontracMonitoringSystem/
├── server/src/
│   ├── index.ts                    boot sequence (DB → driver → engine → HTTP → WS)
│   ├── config/env.ts               PORT, OPC endpoint, poll interval, defaults
│   ├── db/
│   │   ├── schema.sql              tables: users, settings, tags, loops, checkpoints, events
│   │   └── index.ts                initDb() + seedDefaultsIfEmpty() ← add new loops here
│   ├── opc/
│   │   ├── PlcDriver.ts            interface (connect/read/readMany/write/writeMany/dispose)
│   │   ├── OpcUaDriver.ts          real PLC (node-opcua)
│   │   └── SimulatedDriver.ts      in-memory tag store; write() emits tagChanged for live UI
│   ├── monitoring/
│   │   ├── MonitoringEngine.ts     loads all loops from DB, tick loop, exposes sendGo()
│   │   ├── Loop.ts                 ring of checkpoints, virtual shuttles, crash detection
│   │   ├── Checkpoint.ts           per-checkpoint state machine with armed/goEdge model
│   │   ├── VirtualShuttle.ts       id, checkpointIndex, status, movedAtMs, etaMs
│   │   └── crashDetection.ts       per-segment overdue timers → emits crash event
│   ├── alarm/AlarmManager.ts       light-tower blink, buzzer, auto-off, push-button poll
│   ├── ws/gateway.ts               Socket.IO; bridges engine+alarm to clients
│   ├── ws/events.ts                typed event contracts (ServerToClient, ClientToServer)
│   └── http/
│       ├── app.ts                  Express app; registers all routes
│       └── routes/
│           ├── settings.ts         GET/PUT /api/settings
│           ├── tags.ts             GET/PUT /api/tags
│           ├── loops.ts            GET /api/loops, PUT /api/loops/:id
│           ├── checkpoints.ts      GET /api/checkpoints, PUT /api/checkpoints/:id
│           ├── override.ts         POST /api/override/arena
│           ├── sim.ts              GET /api/sim/tags, POST /api/sim/set
│           └── events.ts           GET /api/events
└── client/src/
    ├── App.tsx                     router (/, /login, /settings); /simulation removed
    ├── pages/
    │   ├── Dashboard.tsx           main view; SimulationDialog as overlay
    │   ├── Login.tsx
    │   └── Settings.tsx            system config + per-loop checkpoint distances/buffers
    ├── components/
    │   ├── LoopVisualizer.tsx      SVG loop; rAF animation for moving shuttles
    │   ├── CheckpointCard.tsx      per-checkpoint detect + GO button
    │   ├── ArenaOverride.tsx       L/S/R direction buttons (one per loop)
    │   ├── AlarmBanner.tsx         crash alert + Acknowledge
    │   ├── StatusBar.tsx           WS/PLC status, mode badge, tag-check warnings
    │   └── SimulationDialog.tsx    draggable overlay; input overrides + live outputs
    └── store/
        ├── useLiveState.ts         Zustand; systemState + simTags from socket
        ├── useSettings.ts          Zustand; settings + tags from REST
        └── useAuth.ts              Zustand; session check/login/logout
```

---

## Changes made in this session

### Problem 1 — Simulation panel was a separate page → draggable dialog
- Deleted `/simulation` route from `App.tsx`
- New `SimulationDialog.tsx`: fixed-position, draggable via header, overlays the
  dashboard without losing context
- `Dashboard.tsx`: `simOpen` state toggle replaces `navigate('/simulation')`

### Problem 2 — UI restyle → light/neutral dashboard
- `tailwind.config.ts`: new `surface`/`card`/`line`/`ink` palette; sans-serif body,
  mono reserved for tag IDs and numeric values
- `index.css`: `.panel-card` (white, shadow-card), `.btn-*`, `.field-*`, scrollbars
- All components and pages swept to the new palette

### Problem 3 — Shuttle spawn was order-dependent (broken in simulation)
Root cause: `Checkpoint.updateFromSnapshot` fired the arrival edge on the rising
edge of `detecting`, which meant if `IR3_AR_DET` was set `true` before
`RS232_1_BYTE2` was set the shuttle ID was read as 0 and spawn was skipped.
- **Fix:** order-independent **armed model** in `Checkpoint.ts`:
  `armed = det && id > 0`. `arrivalEdge` fires when `armed` rises regardless of
  which tag changed first.

### Problem 4 — Outputs were invisible in the simulation panel
Root cause: `SimulatedDriver.write/writeMany` wrote the in-memory map but did not
emit `tagChanged`. The gateway only broadcasts `simTags` on `tagChanged`.
- **Fix:** `write()` and `writeMany()` now emit `tagChanged` so GO pulses, ARENA
  L/S/R, light-tower, and buzzer all update live in the sim panel.

### GO semantics redesign (underpins both Sim panel and real mode)
The engine previously **wrote** GO from a dashboard button and never read it back.
Real PLCs **send** GO; the engine should **read** it. This also makes sim and real
mode identical.
- GO tags reclassified to `direction='readwrite'` in DB (seed + migration)
- `Checkpoint.inputNodeIds` now includes the GO node for IRM/IRM_ID types
- `Checkpoint.updateFromSnapshot` computes `goEdge` (GO rising edge)
- `Loop.tick()` calls `handleGo(idx)` on the edge → departs shuttle + starts timer
- `MonitoringEngine.sendGo()` only **writes** a 600ms pulse; the loop departs the
  shuttle when it reads the pulse back on the next tick (same path as real PLC)

### Crash acknowledge — continue monitoring instead of freezing
Two fixes bundled:
1. **Gateway bug:** `loopId` was read *after* `alarmManager.acknowledge()` cleared
   the alarm state → `clearCrashes` was never called. Fixed order of operations.
2. **clearCrashes behavior:** crashed shuttles are now kept `moving` with a new
   timer (`etaMs=0, bufferMs=nextCp.bufferMs`) from `Date.now()`. If the shuttle
   arrives → normal confirm clears the timer. If it misses again → new crash fires.
   The `movingShuttleQueue` is preserved (not cleared) so ordered IRM matching still
   works after recovery.

### Snap virtual shuttle to hardware on arrival (IRM only)
- **IRM_ID**: already snapped by ID — `arriveAt(idx)` repositions regardless of
  where the virtual shuttle was. No change needed.
- **IRM (robot station)**: `handleArrival` now falls back to
  `findAnyShuttleInLoop()` when the `movingShuttleQueue` is empty (e.g. after crash
  ack or on the first cycle). Returns `moving → stopped → crashed` in priority order.
- **SENSOR**: no snap (sensor has no shuttle ID information).

### Settings — checkpoint distance and buffer editable
- New `GET/PUT /api/checkpoints/:id` route in `checkpoints.ts`
- Settings page now shows a table per loop with inline-editable
  **Distance to Next (mm)** and **Crash Buffer (ms)** for each checkpoint

---

## How the monitoring engine works (key invariants)

```
MonitoringEngine.tick()
  → reads all inputNodeIds from DB via driver.readMany()
  → Loop.tick(snapshot)
      → Checkpoint.updateFromSnapshot()  ← computes arrivalEdge + goEdge
      → if arrivalEdge: handleArrival()
          IRM_ID → find/spawn shuttle by ID, arriveAt(idx)
          IRM    → popExpectedShuttle ?? findAnyShuttleInLoop, arriveAt(idx)
          SENSOR → findMovingShuttleFor(prevIdx), advance + new timer
      → if goEdge: handleGo()
          find stopped shuttle at idx, depart(eta), startTracking timer
```

Crash timer fires → `CrashDetector` emits `crash` → `Loop` marks segment red +
marks shuttle crashed → `MonitoringEngine` emits `crash` → `AlarmManager.onCrash`
+ `eventRepo.create` + WebSocket broadcast.

Crash ack → `Loop.clearCrashes()` → crashed shuttles stay moving, new timer from
now with just `bufferMs`.

---

## How to add Loop 2 (and Loop 3)

The engine, database schema, and frontend are already loop-count-agnostic. Adding a
new loop is entirely a **data + tag** operation — no engine code changes needed.

### Step 1 — Identify the hardware tags for the new loop

For each checkpoint, note the OPC UA node IDs:
- **IRM_ID checkpoint**: detect bool tag, shuttle-ID Int32 tag, GO bool tag
- **IRM checkpoint**: detect bool tag, GO bool tag
- **SENSOR checkpoint**: signoff bool tag

### Step 2 — Seed the new loop in `server/src/db/index.ts`

Inside `seedDefaultsIfEmpty()`, the existing Loop 1 block is guarded by
`if (loopCount === 0)`. Extend this block (or add a separate guarded block for
`loopCount < 2`, etc.) following the exact same pattern:

```typescript
// ── Loop 2 example ─────────────────────────────────────────────────────
// Add new tags (use unique logical names)
tagInsert.run('L2_CP1_DET',    ns2 + 'L2_IR_DET',    'Boolean', 'read',      'L2 CP1 IRM detect');
tagInsert.run('L2_RS232_BYTE2',ns2 + 'L2_RS232.BYTE2','Int32',   'read',      'L2 CP1 shuttle ID');
tagInsert.run('L2_CP1_GO',     ns2 + 'L2_IR_GO',      'Boolean', 'readwrite', 'L2 CP1 IRM go signal');
tagInsert.run('L2_CP2_SIGNOFF',ns2 + 'L2_SENSOR',     'Boolean', 'read',      'L2 CP2 sensor');
tagInsert.run('L2_CP3_DET',    ns2 + 'L2_PU_DET',     'Boolean', 'read',      'L2 CP3 IRM detect');
tagInsert.run('L2_CP3_GO',     ns2 + 'L2_PU_GO',      'Boolean', 'readwrite', 'L2 CP3 IRM go signal');
// Arena tags for Loop 2 (if it has its own arena)
tagInsert.run('L2_LU_ARENA',   ns2 + 'L2_LU_ARENA',   'Boolean', 'write',     'L2 Arena: Left');
tagInsert.run('L2_ST_ARENA',   ns2 + 'L2_ST_ARENA',   'Boolean', 'write',     'L2 Arena: Straight');
tagInsert.run('L2_RU_ARENA',   ns2 + 'L2_RU_ARENA',   'Boolean', 'write',     'L2 Arena: Right');

// Loop row — list the shuttle IDs that belong to this loop
db.prepare('INSERT INTO loops (name, description, allowed_shuttle_ids) VALUES (?,?,?)')
  .run('Loop 2', 'Second production loop', '[3]');  // shuttle ID 3 on loop 2
const loop2Id = (db.prepare('SELECT id FROM loops WHERE name=?').get('Loop 2') as {id:number}).id;

// Checkpoints — same structure as Loop 1
cpInsert.run(loop2Id, 0, 'L2-CP1 — Arena IRM (ID)', 'IRM_ID', 6000, 12000,
  getTag('L2_CP1_DET'), getTag('L2_RS232_BYTE2'), getTag('L2_CP1_GO'), null);
cpInsert.run(loop2Id, 1, 'L2-CP2 — Arena Sensor',   'SENSOR', 6000, 12000,
  null, null, null, getTag('L2_CP2_SIGNOFF'));
cpInsert.run(loop2Id, 2, 'L2-CP3 — Robot Station',  'IRM',    6000, 12000,
  getTag('L2_CP3_DET'), null, getTag('L2_CP3_GO'), null);
```

**Important:** `getTag()` is a local closure that reads from the DB. Call it AFTER
all `tagInsert.run()` calls for the same loop.

**Delete `data/montrac.db`** before next boot so `seedDefaultsIfEmpty` re-runs, OR
run the inserts directly with a SQLite client on the live DB. (The seed only runs
when `loopCount === 0`; change this guard to `loopCount < 2` for Loop 2, etc.)

### Step 3 — Arena Override: make it loop-specific

**Current limitation:** `ArenaOverride.tsx` looks up arena tags by the logical names
`LU_ARENA`, `ST_ARENA`, `RU_ARENA` — these are Loop 1 names and will conflict with a
second loop's arena. You need to:

1. Store the arena tag logical names **per-loop** in the DB. Options:
   a. Add `lu_arena_tag`, `st_arena_tag`, `ru_arena_tag` columns to the `loops`
      table (requires a schema migration in `db/index.ts` similar to the
      `allowed_shuttle_ids` migration), or
   b. Use a naming convention (`L{id}_LU_ARENA`) and derive it from `loopId`.

2. Update `ArenaOverride.tsx` to look up tags using the loop-specific names
   (derive from `loopId` prop or from a loop-level DB field).

3. Update `ws/gateway.ts` `arenaOverride` handler — currently it receives
   `lu_node_id / st_node_id / ru_node_id` directly from the client (already
   loop-specific), so the gateway side requires no change.

The simplest approach: naming convention. In `ArenaOverride.tsx` replace:
```typescript
lu_node_id: getNodeId('LU_ARENA'),
st_node_id: getNodeId('ST_ARENA'),
ru_node_id: getNodeId('RU_ARENA'),
```
with:
```typescript
lu_node_id: getNodeId(`L${loopId}_LU_ARENA`),
st_node_id: getNodeId(`L${loopId}_ST_ARENA`),
ru_node_id: getNodeId(`L${loopId}_RU_ARENA`),
```
and name the seed tags accordingly (`L1_LU_ARENA`, `L2_LU_ARENA`, …).

### Step 4 — Restart the server

`npm run dev` — the `MonitoringEngine` calls `db.prepare('SELECT * FROM loops')` on
boot and constructs a `Loop` for every row it finds. The dashboard renders one
`<LoopVisualizer>`, one `<ArenaOverride>`, and `<CheckpointCard>` entries for every
loop in `system.loops` automatically.

### Step 5 — Tune via Settings UI

After boot, open `http://localhost:PORT/settings`. The new loop and its checkpoints
will appear in the "Loop Configuration" section. Adjust:
- **Distance to Next (mm)** per checkpoint
- **Crash Buffer (ms)** per checkpoint  
- **Tracked Shuttle IDs**
- Tag node IDs if they need adjusting

---

## Known limitations / future work

| Area | Note |
|------|------|
| Arena Override | Currently uses globally-named tags (`LU_ARENA`) — needs per-loop names for Loop 2+. See Step 3 above. |
| Multiple shuttles per loop | `findAnyShuttleInLoop()` returns the first shuttle; FIFO ordering via `movingShuttleQueue` only works reliably with one shuttle. For multi-shuttle loops, IRM arrival matching needs a smarter strategy (RFID-like or by closest ETA). |
| Settings hot-reload | Mode / OPC endpoint changes require a server restart. Distance/buffer changes take effect on the next engine reload (restart or settings save route triggers `engine.reload()`). |
| Push Button 1 acknowledge | Configured in Settings as a node ID; not exposed in the sim panel (by design — it's a Settings-level node, not a `tags`-table row). |
| Loop 2/3 checkpoints | The engine supports any number and any mix of IRM_ID / IRM / SENSOR in any order. Minimum viable loop: one IRM_ID (to spawn the shuttle) + at least one more checkpoint. |

---

## Environment

- Windows 11, PowerShell
- Node.js 22 LTS (`node:sqlite` built-in used in place of `better-sqlite3`)
- OPC UA test endpoint: `opc.tcp://10.0.2.2:4845` (dev); real PLC TBD
- Default login: `IMS-2` / `imsystem`
- DB path: `data/montrac.db` (auto-created; gitignored)
