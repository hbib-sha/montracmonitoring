# Montrac Shuttle Monitoring System — Hardware & Monitoring Logic

## Overview

The **Montrac shuttle track** is a conveyor-style shuttle transport system
divided into **3 main loops**. Shuttles travel around these loops continuously
carrying payloads between stations.

The **key constraint** of this system:

> **Shuttles do not report their own position.** The PLC only knows a shuttle
> is present when it physically reaches a designated checkpoint.

Our job is **not** to replicate the control logic of the PLC. We only need to
know *which shuttle is where*, detect anomalies (crashes), and raise alarms.

---

## Track Hardware

### How the track is controlled

Most of the track runs autonomously without PLC involvement. PLC communication
only happens at a **small number of checkpoints** distributed around each loop.

There are two types of checkpoint hardware:

#### 1. Intelligent Routing Modules (IRM)
- Physical modules installed at key junctions on the track.
- Shuttle **always stops** at an IRM and waits for a **GO signal** before continuing.
- Some IRMs have an **RS232 reader** that can identify the shuttle ID.
- Some IRMs are located at **ARENA** junctions (track-direction switches).
- Some IRMs are at **robot stations** (robot picks/places from the shuttle here).

#### 2. Positioning Sensors
- Sensors mounted above the track that trigger when a shuttle passes beneath.
- They **do not stop the shuttle** — the shuttle passes through freely.
- The signal is a **brief pulse** if the shuttle is moving, or **sustained**
  if the shuttle is stationary on top of the sensor.
- Mainly used at ARENA junctions to confirm a shuttle has passed through.

### ARENAs (Track Direction Switches)
- An ARENA is a moveable track section that routes the shuttle in one of
  2–3 directions: **Left (LU)**, **Straight (ST)**, or **Right (RU)**.
- ARENA control is handled by the PLC. We do **not** replicate this logic —
  we only provide an **override** interface so operators can manually set
  the ARENA direction from the dashboard.
- OPC UA tag format: `ns=7;s=S71500ET200MP station_1.Conveyor_ctrl.<TAG_NAME>`
  - Example: `LU_ARENA`, `ST_ARENA`, `RU_ARENA` (booleans)

---

## Virtual Shuttle Concept

Because shuttles are invisible to the system between checkpoints, we maintain
a **virtual shuttle** — a software twin that represents a real physical shuttle.

| Property | Description |
|----------|-------------|
| `id` | Integer shuttle ID (read from RS232 at capable checkpoints) |
| `position` | Which checkpoint the virtual shuttle last passed or is waiting at |
| `eta` | Expected arrival time at the *next* checkpoint |
| `lastSeen` | Timestamp when last confirmed by hardware |
| `status` | `moving` \| `stopped` \| `crashed` |

### How ETAs are calculated

```
ETA = (distance_to_next_checkpoint_mm / avg_shuttle_speed_mm_per_sec) seconds
```

Both **distance** and **average speed** are **user-configurable** per segment
in the Settings page. This allows tuning to match real-world performance.

### Virtual shuttle lifecycle

1. **Spawn:** When an IRM with ID-reader detects a new shuttle ID that doesn't
   yet exist in memory → create virtual shuttle.
2. **Advance:** When a checkpoint confirms detection → update virtual shuttle
   position; reset its ETA for the next segment.
3. **Hold:** When a shuttle is at an IRM, it waits for a GO signal. The
   virtual shuttle is marked as `stopped` until the GO output is sent.
4. **Crash:** When ETA + buffer time elapses with no detection at the expected
   checkpoint → mark virtual shuttle `crashed`, fire alarm.

---

## Loop 1 — Detailed Checkpoint Specification

Loop 1 has **3 checkpoints** in a ring: CP1 → CP2 → CP3 → (back to CP1).

---

### Checkpoint 1 — IRM with Shuttle-ID Reader (ARENA junction)

**Type:** IRM + RS232 reader  
**Location:** ARENA junction (controls track direction)  
**Shuttle behaviour:** Shuttle **stops** here and waits for GO signal.

| Direction | Tag | Type | Description |
|-----------|-----|------|-------------|
| Input | `IR3_AR_DET` | Boolean | IRM detect signal — shuttle present |
| Input | `RS232_1.BYTE2` | Integer | Shuttle ID from RS232 reader |
| Output | `IR3_AR_GO` | Boolean | Send GO signal to release shuttle |

**Monitoring logic:**

1. When `IR3_AR_DET = true` and `RS232_1.BYTE2` returns a valid ID:
   - If no virtual shuttle with that ID exists → **spawn** one at CP1.
   - If virtual shuttle already exists → confirm arrival, reset CP3→CP1
     ETA timer, update position to CP1.
2. Shuttle remains `stopped` at CP1 until `IR3_AR_GO` is written `true`.
3. When GO is sent → start ETA timer for CP1→CP2 segment.
4. **Crash condition (CP3 → CP1 segment):**  
   If a virtual shuttle is `moving` toward CP1 and the ETA for CP3→CP1
   elapses **+ buffer time 1** without `IR3_AR_DET` detecting that shuttle
   ID → **crash between CP3 and CP1**.

---

### Checkpoint 2 — Positioning Sensor (ARENA junction)

**Type:** Positioning sensor  
**Location:** ARENA junction  
**Shuttle behaviour:** Shuttle passes through freely (does NOT stop).

| Direction | Tag | Type | Description |
|-----------|-----|------|-------------|
| Input | `ARENA2_SIGNOFF` | Boolean | True when a shuttle is on the sensor |

**Monitoring logic:**

1. After GO is sent at CP1 → start ETA timer for CP1→CP2.
2. A `moving` shuttle should produce a signal on `ARENA2_SIGNOFF` within
   ETA + buffer time 2.
3. **Crash condition (CP1 → CP2 segment):**  
   ETA + buffer time 2 elapses with no `ARENA2_SIGNOFF` signal →
   **crash between CP1 and CP2**.
4. On signal → confirm transit, reset CP2→CP3 ETA timer.

> **Note:** Because the shuttle does not stop at CP2, the signal is brief
> (a short pulse) if the shuttle is moving through. The system just needs
> to see any rising edge on `ARENA2_SIGNOFF` within the time window.

---

### Checkpoint 3 — Robot Station IRM (no ID reader)

**Type:** IRM only (no RS232)  
**Location:** Robot station  
**Shuttle behaviour:** Shuttle **stops** here and waits for GO signal.

| Direction | Tag | Type | Description |
|-----------|-----|------|-------------|
| Input | `IR2_PU4_DET` | Boolean | IRM detect signal — shuttle present |
| Output | `IR2_PU4_GO` | Boolean | Send GO signal to release shuttle |

**Monitoring logic:**

1. When `IR2_PU4_DET = true`:
   - Confirm virtual shuttle arrival at CP3.
   - Reset CP2→CP3 ETA timer, update position.
   - Mark shuttle `stopped`.
2. Shuttle remains `stopped` at CP3 until `IR2_PU4_GO` is written `true`.
3. When GO is sent → start ETA timer for CP3→CP1 segment.
4. **Crash condition (CP2 → CP3 segment):**  
   ETA + buffer time 3 elapses after the virtual shuttle leaves CP2 without
   `IR2_PU4_DET` triggering → **crash between CP2 and CP3**.
   
   > Special case: Since CP3 cannot read a shuttle ID, if the virtual
   > shuttle is *expected* at CP3 but the detect signal arrives slightly
   > *before* the ETA, it's still valid — we match on timing, not ID.

---

## Crash Detection — Summary

| Segment | Timeout condition | Alarm path |
|---------|------------------|------------|
| CP3 → CP1 | ETA (dist/speed) + Buffer T1 | Red segment CP3→CP1, buzzer on |
| CP1 → CP2 | ETA (dist/speed) + Buffer T2 | Red segment CP1→CP2, buzzer on |
| CP2 → CP3 | ETA (dist/speed) + Buffer T3 | Red segment CP2→CP3, buzzer on |

All buffer times (T1, T2, T3) and segment distances are **user-configurable**
in the Settings page and persisted in SQLite.

---

## System-Wide Behaviours

### Online / Offline Indicator

When the system establishes a real (or simulated) PLC connection:
- A **green light-tower output** is **blinked continuously** via the PLC.
- The tag address of the light tower is **user-defined** in Settings.
- If connection drops, blinking stops (light tower goes dark = system offline).

The dashboard shows a live connection status indicator in the status bar.

### Startup Tag Readability Check

On boot, after the driver connects, the system:
1. Reads every tag registered in the `tags` table.
2. Reports which tags are readable and which fail.
3. Shows results in the Status Bar on the dashboard.
4. Continues running — unreadable tags are flagged but don't prevent startup.

### Authentication

- Simple session-based login.
- Default credentials: **Username:** `IMS-2` / **Password:** `imsystem`
- All `/api/*` routes and the dashboard require an active session.
- Credentials are stored hashed (bcrypt) in the `users` table.

### Alarm System (Progressive)

| Trigger | Action |
|---------|--------|
| Crash detected | Mark segment red on visualizer |
| | Write `true` to **buzzer** tag (user-defined address) |
| | Enter progressive alarm mode (banner on dashboard) |
| Auto-clear | After **30 seconds** (user-modifiable in Settings) |
| Physical ack | **Push Button 1** input tag (user-defined) goes high |
| Web ack | Operator clicks **Acknowledge** button in dashboard |

On acknowledge / auto-clear:
- Buzzer tag written `false`
- Red segment cleared
- Alarm banner dismissed
- Crash recorded in `events` table with timestamp

### Simulation Mode

When started in simulation mode:
- No real OPC UA connection is made.
- A **SimulatedDriver** holds an in-memory copy of all tag values.
- A **Simulation Override Panel** appears alongside the dashboard, allowing
  the operator to manually set any tag value (boolean or integer).
- This allows full end-to-end testing of the monitoring logic without hardware:
  - Simulate `IR3_AR_DET = true` + `RS232_1.BYTE2 = 5` → shuttle 5 spawns at CP1.
  - Withhold `ARENA2_SIGNOFF` past buffer time 2 → crash alarm fires.
  - Simulate `PB1 = true` → alarm acknowledges.

---

## OPC UA Tag Reference (Loop 1)

All tags follow the format:
```
ns=7;s=S71500ET200MP station_1.<MODULE>.<TAG_NAME>
```

| Logical Name | OPC UA Node ID Suffix | Type | Direction |
|---|---|---|---|
| `IR3_AR_DET` | `Conveyor_ctrl.IR3_AR_DET` | Boolean | Read |
| `RS232_1_BYTE2` | `Conveyor_ctrl.RS232_1.BYTE2` | Int | Read |
| `IR3_AR_GO` | `Conveyor_ctrl.IR3_AR_GO` | Boolean | Write |
| `ARENA2_SIGNOFF` | `Conveyor_ctrl.ARENA2_SIGNOFF` | Boolean | Read |
| `IR2_PU4_DET` | `Conveyor_ctrl.IR2_PU4_DET` | Boolean | Read |
| `IR2_PU4_GO` | `Conveyor_ctrl.IR2_PU4_GO` | Boolean | Write |
| `LU_ARENA` | `Conveyor_ctrl.LU_ARENA` | Boolean | Write |
| `ST_ARENA` | `Conveyor_ctrl.ST_ARENA` | Boolean | Write |
| `RU_ARENA` | `Conveyor_ctrl.RU_ARENA` | Boolean | Write |
| `LIGHT_TOWER` | *(user-defined)* | Boolean | Write |
| `BUZZER` | *(user-defined)* | Boolean | Write |
| `PUSH_BUTTON_1` | *(user-defined)* | Boolean | Read |

> Tag addresses for the light tower, buzzer, and push button are configured
> by the user in the Settings page and stored in the database. The Loop 1
> checkpoint tags above are seeded as defaults on first boot.

---

## Configurable Parameters (persisted in SQLite)

| Parameter | Default | Description |
|-----------|---------|-------------|
| OPC UA Endpoint | `opc.tcp://10.0.2.2:4845` | PLC connection address |
| Buffer Time T1 | 10 000 ms | Grace period on CP3→CP1 segment |
| Buffer Time T2 | 10 000 ms | Grace period on CP1→CP2 segment |
| Buffer Time T3 | 10 000 ms | Grace period on CP2→CP3 segment |
| Segment distance CP1→CP2 | 5 000 mm | Physical distance between checkpoints |
| Segment distance CP2→CP3 | 5 000 mm | Physical distance between checkpoints |
| Segment distance CP3→CP1 | 5 000 mm | Physical distance between checkpoints |
| Average shuttle speed | 200 mm/s | Used to compute ETAs |
| Alarm auto-clear time | 30 000 ms | Time before alarm self-clears |
| Light tower tag address | *(unset)* | OPC UA node ID |
| Buzzer tag address | *(unset)* | OPC UA node ID |
| Push Button 1 tag address | *(unset)* | OPC UA node ID |

---

## Loops 2 & 3 (Future)

The monitoring engine is **loop-count agnostic**. To add Loop 2 or 3:
1. Add a row to the `loops` table.
2. Add checkpoint rows to the `checkpoints` table with their tag assignments.
3. Add tag rows to the `tags` table.
4. Add a second/third `LoopVisualizer` component on the Dashboard.

No changes to the engine, alarm manager, or WebSocket gateway are required.
