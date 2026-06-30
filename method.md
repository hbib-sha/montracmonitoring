# Method — Discrete-Event Digital Twin & Crash Monitoring

This document explains *how* the Montrac Monitoring System works at a conceptual
level: it maintains a lightweight, **discrete-event** software model (a "digital
twin" of deliberately limited accuracy) of the shuttles moving around the
physical Montrac conveyor rings, and layers a **monitoring and alerting** system
on top that detects likely crashes and raises alarms.

It is intentionally honest about what the model does *not* do — it is a tracking
and supervision aid, not a physics simulator.

---

## 1. The physical system

The plant is one or more closed conveyor **loops** (rings). Shuttles (carriers)
travel around a loop and stop at fixed **checkpoints**. The PLC exposes a handful
of binary/integer signals per checkpoint over OPC UA:

- **Detect** — a sensor goes high while a shuttle is present at the checkpoint.
- **Shuttle ID** — at ID-reading checkpoints (RS232/IRM_ID), an integer identifies
  which shuttle arrived.
- **GO** — a release pulse that sends a stopped shuttle on to the next checkpoint.
- **Sign-off / sensor** — photocell-style position confirmation at SENSOR checkpoints.

Crucially, the PLC tells us **events** ("a shuttle just arrived at checkpoint 2",
"checkpoint 1 was released"), not continuous positions. There is no encoder
streaming a live X/Y of every shuttle. That single fact is what makes a
discrete-event approach the natural fit.

---

## 2. Why a digital twin, and why "limited accuracy"

We want a live dashboard that shows where each shuttle is, predicts when it
should reach the next checkpoint, and notices when one *doesn't*. To do that we
keep a software model — a **digital twin** — of every shuttle and checkpoint in
memory, updated to mirror the real plant.

The twin is **deliberately low-fidelity**:

- It models shuttles as points that occupy a checkpoint or are "in transit" along
  a segment. There is **no real physics** — no mass, acceleration, friction, or
  motor dynamics.
- Position *between* checkpoints is not measured; it is **estimated** by linear
  interpolation from a single global average speed (see §4).
- It only learns ground truth at the moments the PLC fires an event.

This is enough to drive a useful operator dashboard and crash supervision, while
staying simple, cheap to run, and configurable entirely from the database (adding
a loop requires no code changes). We trade fidelity for robustness and clarity.

---

## 3. Discrete-event simulation model

A discrete-event simulation advances state only at distinct points in time —
when an *event* occurs — rather than integrating continuously. Our twin has two
kinds of events:

1. **External events** — rising edges on PLC signals (arrival detect, ID change,
   GO release). These are the "real" events from the plant.
2. **Internal scheduled events** — crash-deadline timers we create ourselves
   (§5). These are future events that fire unless cancelled by an external event.

### 3.1 The sampling loop

The real plant is polled, not interrupt-driven, so we approximate an event stream
by **sampling every 200 ms** (`config.pollIntervalMs`):

```
MonitoringEngine.tick()        every 200 ms
  └─ read all input tags from the PLC driver (one snapshot)
       └─ Loop.tick(snapshot)               for each loop
            └─ Checkpoint.updateFromSnapshot(snapshot)   for each checkpoint
                 → detects rising edges → sets arrival / GO / id-changed flags
            └─ Loop reacts to those edge flags
```

`Checkpoint` holds the previous sample's state and reports an event only on a
**rising edge** (low→high), so a signal that stays high for several samples
produces exactly one arrival event. The 200 ms period is the model's time
quantum — events are resolved to within one poll cycle.

*Files: `server/src/monitoring/MonitoringEngine.ts`, `Loop.ts`, `Checkpoint.ts`.*

### 3.2 Virtual shuttles as a state machine

Each tracked shuttle is a `VirtualShuttle` with a tiny state machine:

```
            GO released                 arrival event at next checkpoint
  stopped ───────────────► moving ──────────────────────────────► stopped
     ▲                       │
     │                       │ deadline passes with no arrival
     └───────── (ack/recovery)└──────────────► crashed
```

- **stopped** — parked at a checkpoint (its `checkpointIndex`).
- **moving** — released; we record `movedAtMs` and a predicted `etaMs`.
- **crashed** — the expected arrival never confirmed in time (§5).

Events drive the transitions:

- An **ID-change / arrival** event at an `IRM_ID` checkpoint *spawns* a shuttle
  (if its ID is in the loop's allowed list) or *advances* an existing one,
  snapping it to that checkpoint (`arriveAt`).
- A **GO** rising edge *departs* the stopped shuttle (`depart`), starting a
  transit.
- At ID-less checkpoints (`IRM` / `SENSOR`) there is no identity in the signal, so
  the model advances the shuttle that departed the **immediately preceding**
  checkpoint — never an arbitrary shuttle — which keeps shared sensor addresses
  across loops from "teleporting" the wrong carrier.

*Files: `VirtualShuttle.ts`, `Loop.ts`.*

### 3.3 Position & ETA estimation (the interpolation layer)

When a shuttle departs checkpoint *i*, we predict its travel time to *i+1*:

```
etaMs = (distanceMmToNext / avgSpeedMmPerSec) × 1000
```

The dashboard animates the marker by linearly interpolating along the segment
using `progress = (now − movedAtMs) / etaMs`. This is the **single biggest
source of limited accuracy**: it assumes every shuttle moves at one constant
average speed over a fixed nominal distance. Real shuttles accelerate, queue,
and vary — none of which the model sees until the next checkpoint event corrects
it.

---

## 4. Where the accuracy is limited (by design)

| Limitation | Consequence |
|---|---|
| Single global average speed, no per-segment dynamics | Inter-checkpoint position is an estimate, not a measurement |
| Linear interpolation, no acceleration/queuing | Marker may lead or lag the real shuttle mid-segment |
| 200 ms polling | Event timing resolved only to ±1 poll cycle |
| Identity known only at ID checkpoints | Between them, identity is inferred from sequence, not read |
| Nominal distances (manual or lightly calibrated) | ETA and crash thresholds are approximate |

The model **self-corrects at every checkpoint**: whatever drift accumulates
during a segment is erased the moment a real arrival event snaps the shuttle to
its true checkpoint. So the twin is accurate *at* checkpoints and approximate
*between* them. For an operator overview and crash supervision, that is
sufficient.

### Calibration (narrowing the gap)

To make the nominal distances less arbitrary, an **auto-calibration** mode records
a shuttle over several real laps, averages the measured travel time per segment,
and back-solves the distance so the ETA formula reproduces reality
(`distance = avgMs × avgSpeed / 1000`). This tightens both the predicted ETAs and
the crash thresholds derived from them.

*File: `server/src/calibration/CalibrationService.ts`.*

---

## 5. Crash detection as scheduled events

Crash detection is the clearest example of the discrete-event idea: every transit
schedules a **future deadline event** that the model races against the plant.

When a shuttle departs checkpoint *i* heading to *i+1*, we start a timer:

```
deadline = etaMs + bufferMs        (the buffer is a tolerance/grace window)
```

- If the **arrival event** for that segment fires before the deadline, we
  *cancel* the timer (`confirmArrival`) — the shuttle made it.
- If the **deadline fires first**, no arrival was seen in time, so we emit a
  **crash event** for that segment and mark the shuttle `crashed`.

This is a per-segment "watchdog": the expected event must arrive within
ETA + buffer, or the absence of the event *is itself* the signal that something
went wrong (a stall, jam, or collision).

*File: `server/src/monitoring/crashDetection.ts`.*

---

## 6. Monitoring & alerting

A crash event flows from the engine to the `AlarmManager`, which turns it into
operator-visible and physical alerts:

1. **Physical alarm** — energises the **buzzer** and uses the **light tower**
   output; the light tower also blinks continuously (every 1 s) as a "system
   online" heartbeat.
2. **Event log** — the crash is written to the `events` table (loop, segment,
   timestamp) for history and reporting.
3. **Dashboard** — the crashed segment turns red and the alarm banner appears;
   the browser also plays an alarm sound. State is pushed live over Socket.IO
   (`systemState` / `alarmUpdate`).
4. **Acknowledge** — the alarm clears when an operator presses the physical
   **push button** or acknowledges in the web UI. An auto-off timer (default 30 s)
   is a final backstop.

### Auto-recovery (false-alarm suppression)

A merely *delayed* shuttle (slow segment, brief stall) trips the same deadline as
a real crash. If that shuttle then actually arrives, the model clears the crashed
segment and emits a **recovery** event. The `AlarmManager` treats this as a false
alarm and **silences the alarm automatically** — provided the recovered loop has
no other crashed segments left — and resolves the logged event. A genuine crash
(the shuttle never arrives) produces no recovery event, so its alarm persists
until acknowledged.

*Files: `server/src/alarm/AlarmManager.ts`, `server/src/ws/gateway.ts`.*

---

## 7. Summary

```
 Physical plant (PLC / OPC UA)
        │  discrete signals (detect, ID, GO, sign-off)
        ▼
 Sampling loop (200 ms)  ──►  rising-edge detection  ──►  EVENTS
        │
        ▼
 Discrete-event digital twin
   • virtual shuttles (stopped / moving / crashed)
   • position estimated by ETA = distance ÷ avg speed   ← limited accuracy
   • self-corrects at every checkpoint event
   • schedules per-segment crash-deadline timers
        │
        ├──► Dashboard (live positions, ETAs, status)
        └──► Crash detection ──► AlarmManager
                                   • light tower + buzzer
                                   • event log
                                   • acknowledge (button / web)
                                   • auto-recovery on false alarm
```

The system is best understood as a **discrete-event tracker with a supervisory
watchdog**: it mirrors the plant accurately at the moments events occur,
estimates the in-between with a coarse constant-speed model, and uses the
*expected-but-missing* event as the trigger for crash alerts.
