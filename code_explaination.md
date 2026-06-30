# Code Explanation — Building a Discrete-Event Monitoring System

This document explains **how the code is structured** so that it functions as a
discrete-event-simulation (DES) monitoring system. Where [`method.md`](./method.md)
covers the *concept*, this file is the *code map*: it walks the modules in the
order data flows through them, and calls out the pattern that makes the design
reusable for any event-driven monitoring problem.

> **The core idea, in one line:** poll a source of discrete signals → turn signal
> *edges* into *events* → advance an in-memory model on each event → schedule
> *future* events (deadlines) that, if they fire unanswered, raise an alarm.

---

## 1. Repository layout

```
server/                    Node + TypeScript backend
  src/
    index.ts               Boot/composition root — wires everything together
    config/env.ts          Constants (poll rate = 200 ms, ports, paths)
    types/index.ts         Shared domain types + event payloads + WS contracts

    opc/                   ── Signal source (the "world") ──
      PlcDriver.ts         Interface: read/readMany/write/writeMany/isConnected
      OpcUaDriver.ts       Real PLC over node-opcua
      SimulatedDriver.ts   In-memory tag store (dev/testing, drives the sim panel)
      tagRegistry.ts       logical_name ↔ node_id lookup, loaded from DB

    monitoring/            ── The discrete-event engine ──
      MonitoringEngine.ts  Owns the 200 ms tick; loads loops; emits events
      Loop.ts              One ring: checkpoints + virtual shuttles + reactions
      Checkpoint.ts        Per-checkpoint rising-edge detection (signal → event)
      VirtualShuttle.ts    Shuttle state machine (stopped/moving/crashed)
      crashDetection.ts    Per-segment deadline timers (scheduled future events)

    alarm/AlarmManager.ts  Crash/recovery → light tower, buzzer, auto-off, ack
    recording/             Records runs + per-segment timings (for analysis)
    calibration/           Back-solves segment distances from real laps

    db/
      schema.sql           Tables: tags, loops, checkpoints, events, recordings…
      index.ts             Init + idempotent seed of loops/checkpoints/tags
      repositories/        Thin typed query helpers (eventRepo, settingsRepo…)

    http/                  Express REST (app.ts + routes/) — config & control
    ws/
      gateway.ts           Socket.IO bridge: engine/alarm events → browsers
      events.ts            Typed ServerToClient / ClientToServer contracts

client/                    React + Vite dashboard
  src/
    store/                 Zustand stores fed by REST + WebSocket
      useLiveState.ts      Live systemState/alarm/calibration from the socket
    components/, pages/    Visualizers, settings, reports, geometry editor
    lib/socket.ts          Socket.IO client (typed with server's events.ts)
```

The backend is the simulation + monitoring core; the frontend is a thin live
view. **All plant topology lives in the database, not in code** — see §7.

---

## 2. The signal source: `PlcDriver`

Everything starts from a stream of discrete signals. The engine never talks to
hardware directly; it depends only on an interface:

```ts
interface PlcDriver {
  read(nodeId): Promise<value | undefined>
  readMany(nodeIds): Promise<Record<nodeId, value>>   // bulk read — used per tick
  write(nodeId, value): Promise<boolean>
  readonly isConnected: boolean
  ...
}
```

Two implementations satisfy it (`server/src/opc/`):

- **`OpcUaDriver`** — the real PLC via `node-opcua`.
- **`SimulatedDriver`** — an in-memory tag map you can write to from the UI sim
  panel. This is what lets you develop and demo the *entire* monitoring system
  with no hardware.

Selection happens once at boot from `settings.mode` (`index.ts`). **This
abstraction is the key to testability**: the DES engine above it cannot tell real
from simulated input, so the same monitoring logic is exercised either way.

`tagRegistry` maps human-readable `logical_name`s to OPC `node_id`s (loaded from
the `tags` table), so checkpoints refer to signals by meaning, not address.

---

## 3. Signal → event: `Checkpoint`

A discrete-event system needs **events**, but a PLC gives **levels** (a detect
line that is high while a shuttle sits there). `Checkpoint` converts one to the
other by remembering the previous sample and reporting only **rising edges**.

`Checkpoint.updateFromSnapshot(snapshot)` (called once per tick) computes, per
checkpoint type, three one-shot event flags:

| Flag | Meaning | Fires when |
|---|---|---|
| `arrivalEdge` | a shuttle just arrived | armed signal goes low→high |
| `idChangedEdge` | a new shuttle ID was read | `IRM_ID` reader changes to a new non-zero value |
| `goEdge` | release pulse | GO output goes low→high |

The "armed" definition is order-independent (e.g. an `IRM_ID` is armed when
`detect && id > 0`, regardless of which arrived first), which makes edge
detection robust to signal ordering and to values that linger between passes.

> **Reusable pattern #1 — edge detection.** This class is the generic
> "level → event" converter. Any monitoring system over polled boolean inputs
> needs exactly this: store previous state, emit on transition, consume once.

---

## 4. The clock: `MonitoringEngine`

`MonitoringEngine` is the simulation's heartbeat. On `start()` it loads every
loop from the DB, then sets a fixed-interval timer:

```ts
setInterval(() => this.tick(), config.pollIntervalMs /* 200 ms */)
```

Each `tick()`:

1. Collects all input node IDs needed by all loops (deduplicated).
2. Does **one bulk `readMany`** — a single coherent snapshot of the plant.
3. Passes that snapshot to every `Loop.tick(snapshot)`.

The 200 ms period is the model's **time quantum**: events are resolved to within
one cycle. The engine re-emits the loops' domain events (`crash`,
`shuttleAdvanced`, `recovered`, `stateChanged`) upward via `EventEmitter` so the
WebSocket gateway and recording/alarm services can subscribe without the engine
knowing they exist.

`reload(avgSpeed)` re-reads loops/checkpoints from the DB and restarts — the only
path that applies config changes (e.g. calibration) to the running model live.

---

## 5. The model: `Loop`, `VirtualShuttle`

`Loop` holds the live state of one ring: its ordered `Checkpoint[]`, a
`Map<shuttleId, VirtualShuttle>`, the list of currently-crashed segments, and a
`CrashDetector`. `Loop.tick()` reads the edge flags each checkpoint set and
dispatches:

```ts
this.checkpoints.forEach((cp, idx) => {
  cp.updateFromSnapshot(snapshot);
  if (cp.idChangedEdge) this.handleIdChange(cp, idx);   // spawn / advance by ID
  if (cp.arrivalEdge)   this.handleArrival(cp, idx);    // confirm arrival
  if (cp.goEdge)        this.handleGo(idx);             // depart on release
});
```

### The shuttle state machine (`VirtualShuttle`)

```
            GO edge                       arrival event at next checkpoint
  stopped ──────────► moving ───────────────────────────────────────► stopped
     ▲                  │
     │                  │ crash-deadline timer fires first
     └─ (ack/recovery) ─└──────────────────────────────────► crashed
```

- `arriveAt(idx)` — snap to a checkpoint, status `stopped`, clear timing.
- `depart(etaMs)` — status `moving`, record `movedAtMs` and predicted `etaMs`.
- `crash()` — status `crashed`.

### Event handlers (where the simulation "advances")

- **`handleIdChange` / `handleArrival`** — at `IRM_ID`, spawn a shuttle (if its ID
  is allowed on this loop) or advance an existing one; at `IRM`/`SENSOR` (no
  identity in the signal) advance the shuttle that departed the **immediately
  preceding** checkpoint, never an arbitrary one — this prevents shared sensor
  addresses across loops from teleporting the wrong shuttle.
- **`handleGo`** — depart the stopped shuttle, compute its ETA, and **schedule the
  crash deadline** for the segment it just entered.

### Position estimate (the low-fidelity part)

Distance and speed give a predicted travel time; there is no physics:

```ts
etaMs = (cp.distanceMmToNext / avgSpeedMmPerSec) * 1000
```

The model is exact *at* checkpoints (every arrival event snaps the shuttle to
truth) and interpolated *between* them (the dashboard animates with
`progress = (now − movedAtMs) / etaMs`). That trade-off is the system's
deliberate "limited accuracy."

---

## 6. Monitoring: scheduled events + alarm

### 6.1 Crash detection = a future event racing the plant (`crashDetection.ts`)

When a shuttle departs checkpoint *i* toward *i+1*, `CrashDetector.startTracking`
schedules a deadline:

```ts
setTimeout(() => emit('crash', {...}), etaMs + bufferMs)   // keyed per segment
```

- If the **arrival event** arrives first, `confirmArrival()` cancels the timer.
- If the **timer fires first**, the expected event never came → emit `crash`.

> **Reusable pattern #2 — the watchdog.** Schedule a future "deadline" event when
> you expect something; cancel it when the expectation is met; treat its firing
> as the anomaly signal. This is the heart of DES-based monitoring: *the absence
> of an expected event is itself an event.* `bufferMs` is the tolerance window.

### 6.2 From crash event to alert (`AlarmManager`, `ws/gateway.ts`)

The gateway subscribes to engine events and fans them out:

```
engine 'crash'  ─► AlarmManager.onCrash()  ─► buzzer + light tower on
                ─► eventRepo.create(...)    ─► row in events table
                ─► broadcastState()         ─► browsers (red segment, banner, sound)

engine 'recovered' ─► AlarmManager.onRecovery() ─► auto-clear if loop has no
                                                    crashes left (false alarm)
                   ─► eventRepo.resolveOpenSegment(...)
```

`AlarmManager` also blinks the light tower as an "online" heartbeat, polls the
physical **push button** to acknowledge, exposes a **web acknowledge**, and has a
30 s auto-off backstop. A *delayed* shuttle that finally arrives clears its
segment and emits `recovered`, which silences a false alarm automatically; a
*real* crash emits no recovery, so its alarm persists until acknowledged.

---

## 7. Configuration-as-data: adding a loop without code

The monitoring topology is **pure database configuration** (`db/schema.sql`,
seeded in `db/index.ts`):

- `tags` — OPC signals (`logical_name`, `node_id`, direction).
- `loops` — a ring + its `allowed_shuttle_ids`.
- `checkpoints` — ordered `sequence`, `type` (`IRM_ID`/`IRM`/`SENSOR`),
  `distance_mm_to_next`, `buffer_ms`, and which tags supply detect/ID/GO/signoff.
- `events` — the crash/alarm log (+ `resolved_at`, `acknowledged`).

Because `MonitoringEngine.loadLoops()` builds the entire model from these tables
at boot (and on `reload`), **adding a new ring requires inserting rows, not
writing code**. This is what makes the engine a general monitoring framework
rather than a one-off.

---

## 8. Getting it to the operator: events → WebSocket → stores

The server is push-based. `ws/gateway.ts` translates engine/alarm events into
typed Socket.IO messages declared in `ws/events.ts`:

- `systemState` — full snapshot (loops, shuttles, checkpoints, alarm) on every
  change.
- `alarmUpdate`, `recordingStatus`, `calibrationStatus`, `simTags`.

The browser (`client/src/lib/socket.ts` is typed with the *same* `events.ts`) feeds
these into Zustand stores (`useLiveState`, …). Components subscribe reactively:
`LoopVisualizer` / `CombinedTrackCanvas` animate shuttles along each loop,
`AlarmBanner` + `useAlarmSound` surface alarms, `Reports`/`Settings`/
`GeometryEditor` handle analysis and configuration. REST routes under `http/`
cover non-realtime config and control (settings, checkpoints, recording,
calibration, GO, acknowledge).

---

## 9. Supporting subsystems

- **Recording (`recording/RecordingService.ts`)** — when active, samples the full
  `SystemState` every second and records every `shuttleAdvanced` event's
  predicted-vs-actual time into `segment_timings`. This is the data used to judge
  the twin's accuracy and crash-detection latency.
- **Calibration (`calibration/CalibrationService.ts`)** — taps the same
  `shuttleAdvanced` events, averages real per-segment travel times over a few
  laps, and back-solves `distance = avgMs × avgSpeed / 1000` so the ETA formula
  reproduces reality; `apply()` writes the distances and `engine.reload()`s.

Both attach to the engine's existing event stream — a good illustration that new
monitoring/analysis features are added by **subscribing to events**, not by
modifying the core loop.

---

## 10. How to build a DES monitoring system with this structure

To apply this pattern to another event-driven plant:

1. **Implement `PlcDriver`** for your signal source (or reuse the sim driver to
   prototype). Bulk-read a coherent snapshot per tick.
2. **Define edge detection** (`Checkpoint`-style): store previous state, emit
   one-shot event flags on transitions.
3. **Pick a tick rate** (`config.pollIntervalMs`) — your time quantum.
4. **Model entities as a small state machine** (`VirtualShuttle`-style) advanced
   only by events.
5. **Schedule deadline timers** for every "expected next event"
   (`crashDetection`-style); cancel on confirmation, alarm on expiry.
6. **Fan events out** to alarm/log/UI via an `EventEmitter` + WebSocket bridge so
   the core stays decoupled.
7. **Keep topology in data**, so new monitored units need configuration, not code.

The result is a small, testable, hardware-optional monitoring core whose accuracy
you can tune with calibration and measure with recording — exactly the shape of
this codebase.
