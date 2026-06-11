# Montrac Monitoring System — Handoff 2

**Date:** 2026-06-11  
**Status:** Loop 2 seeded and visible. Six bugs fixed. Alarm sound added.
One open issue raised at end of session (Loop 2 spawn consistency — not yet implemented).

---

## What changed in this session

### 1 — Stop Loop feature
Resets a loop entirely: despawns all virtual shuttles, cancels crash timers,
clears crashed segments, and resets checkpoint edge-detection state so the
next tick spawns fresh.

**Files changed:**
- `server/src/monitoring/Checkpoint.ts` — added `resetEdgeState()` (zeroes
  `prevArmed`/`prevGo` and edge flags)
- `server/src/monitoring/Loop.ts` — added `reset()` (calls
  `crashDetector.clearLoop`, clears `shuttles` map, `movingShuttleQueue`,
  `crashedSegments`, calls `resetEdgeState()` on every checkpoint, emits
  `shuttleUpdate`)
- `server/src/monitoring/MonitoringEngine.ts` — added `resetLoop(loopId)`
  delegating to `loop.reset()`
- `server/src/ws/events.ts` — added `stopLoop: (payload: { loopId: number })
  => void` to `ClientToServerEvents`
- `server/src/ws/gateway.ts` — added `socket.on('stopLoop', ...)` handler
- `client/src/components/LoopVisualizer.tsx` — red **Stop** button in loop
  header, disabled when no shuttles present; emits `stopLoop`

---

### 2 — Git repository initialised and pushed
- `README.md` created with setup, environment variables, project structure,
  engine flow, feature list, scripts, and database notes
- `git init` + initial commit of all 67 project files
- Remote: `https://github.com/hbib-sha/montracmonitoring.git`
- `prompt.txt` subsequently untracked and added to `.gitignore`

---

### 3 — VirtualBox dev access fix
- `client/vite.config.ts`: added `host: '0.0.0.0'` to `server` config so
  Vite listens on all interfaces, not just loopback
- Forward **port 5173** in VirtualBox NAT → access `http://localhost:5173`
  on the host. Port 3000 (Express) does not need to be forwarded; Vite proxies
  `/api` and `/socket.io` internally

---

### 4 — Unreadable tag tooltip
- `client/src/components/StatusBar.tsx` — the "⚠ N tag(s) unreadable" badge
  now has a `title` attribute listing the logical names of all unreadable tags,
  one per line. Hover to see which tags are failing

---

### 5 — Tag Node ID save was silently failing
**Root cause:** `PUT /api/tags/:id` validated with `TagSchema` which required
`logicalName: z.string().min(1)` (no default). The client only sent the changed
field `{ nodeId: "..." }` → Zod returned a 400 → UI showed "Saved" anyway.

**Fix:** `server/src/http/routes/tags.ts` — changed `TagSchema.safeParse` to
`TagSchema.partial().safeParse` for the PUT handler. The existing
`{ ...existing, ...parsed.data }` merge pattern handles partials correctly.

---

### 6 — Arena override not working when tags not loaded
Three bugs found together:

1. **Tags never fetched on Dashboard** — `useSettings.fetch()` was only called
   in `Settings.tsx`. `Dashboard.tsx` never called it, so `tags` was always `[]`
   unless the user visited Settings first in the same session. `getNodeId()`
   returned `''` for all arena tags → gateway received empty node IDs → writes
   silently did nothing.

2. **No gateway guard** — empty node IDs were passed straight to
   `driver.writeMany()` with no log or rejection.

3. **No user feedback** — button showed "Sending…" regardless of outcome.

**Fixes:**
- `client/src/pages/Dashboard.tsx` — added `useSettings` import and
  `useEffect(() => { fetchSettings(); }, [fetchSettings])` on mount
- `client/src/components/ArenaOverride.tsx` — computed `configured` flag;
  buttons are `disabled` and an amber warning shown when any node ID is `''`
- `server/src/ws/gateway.ts` — added early-return guard with `logger.warn`
  when any of `lu_node_id / st_node_id / ru_node_id` is falsy

---

### 7 — Alarm sound
- `client/src/hooks/useAlarmSound.ts` — new hook; plays `/alarm.mp3` (looped)
  when `active` transitions to `true`. On error or if the file is missing, falls
  back to a generated two-tone square-wave alarm (880 Hz / 660 Hz alternating
  every 400 ms) via the Web Audio API. Sound stops when `active` becomes false
  or the component unmounts.
- `client/src/components/AlarmBanner.tsx` — calls
  `useAlarmSound(alarm.state === 'active')`

**To use an MP3:** place any audio file at `client/public/alarm.mp3`. It will
be served as a static asset by Vite (dev) and Express (production).

---

### 8 — Loop 2 added
Same 3-checkpoint structure as Loop 1. Arena tags are **shared** (one physical
arena serves both loops).

**DB seed (`server/src/db/index.ts`):**
- New `if (loopCount2 < 2)` block inserts Loop 2 tags, loop row, and checkpoints
- Loop 2 tags seeded with placeholder node IDs — update via Settings after first
  boot on a fresh DB

| Logical name | Type | Direction | Description |
|---|---|---|---|
| `IR4_AR_DET` | Boolean | read | L2 CP1 IRM detect |
| `RS232_2_BYTE2` | Int32 | read | L2 CP1 shuttle ID reader |
| `IR4_AR_GO` | Boolean | readwrite | L2 CP1 IRM go signal |
| `L2_ARENA2_SIGNOFF` | Boolean | read | L2 CP2 positioning sensor |
| `L2_IR2_PU4_DET` | Boolean | read | L2 CP3 IRM detect |
| `L2_IR2_PU4_GO` | Boolean | readwrite | L2 CP3 IRM go signal |

**Loop 2 checkpoints:**
```
CP1 (sequence 0) — IRM_ID  — IR4_AR_DET / RS232_2_BYTE2 / IR4_AR_GO
CP2 (sequence 1) — SENSOR  — L2_ARENA2_SIGNOFF
CP3 (sequence 2) — IRM     — L2_IR2_PU4_DET / L2_IR2_PU4_GO
```

Default tracked shuttle ID: `[3]` — update in Settings → Loop 2 → Tracked IDs.

**Arena override simplified:**
- `ArenaOverride` no longer takes `loopId`/`loopName` props; it is rendered
  once as a shared panel in `Dashboard.tsx`
- Uses `LU_ARENA / ST_ARENA / RU_ARENA` (same tags as Loop 1, shared)

**To activate Loop 2 on an existing DB:**
```bash
rm data/montrac.db   # seed re-runs on next boot
npm run dev
```
Then go to **Settings → Tag Addresses** and enter the real OPC UA node IDs for
the six Loop 2 tags listed above.

---

## Open issue — Loop 2 spawn consistency (NOT YET IMPLEMENTED)

**Problem raised:** On Loop 2's IRM_ID checkpoint (CP1), the shuttle spawn is
sometimes missed because the armed model requires `det=true AND id>0`
simultaneously. If the RS232 ID reader updates its value (`RS232_2_BYTE2`)
faster than the IRM detect signal (`IR4_AR_DET`) clears after the shuttle
passes, or if the ID tag retains its last value between shuttle passes, the
`armed` condition may never produce a clean rising edge.

**Proposed solution (not implemented):** Instead of requiring both `det=true`
and `id>0` to arm simultaneously, continuously monitor the shuttle ID tag and
spawn/snap the shuttle as soon as the ID changes to a value in
`allowedShuttleIds` — regardless of the detect signal. The detect signal would
only be used to confirm physical presence for GO handling.

**Where to implement:** `Checkpoint.ts` — `updateFromSnapshot()` for `IRM_ID`
type. A new `idChangedEdge` flag could fire when `rawId` transitions from any
value to a recognised shuttle ID, independent of `det`. `Loop.handleArrival()`
would then also respond to `idChangedEdge` in addition to `arrivalEdge`.

Key consideration: the ID tag on a real RS232 reader may hold the last-read
value after the shuttle departs (no "clear to 0" signal). The implementation
must guard against re-spawning on a stale ID — only fire the edge when the ID
value *changes* to a known shuttle ID, not just when it equals a known ID.

---

## Repository state

- Remote: `https://github.com/hbib-sha/montracmonitoring.git`
- Branch: `master`
- Last commit: `Add Loop 2 with shared arena override`

## Environment

- Windows 11 / PowerShell (development host)
- VirtualBox Linux server (runtime) — access via `http://localhost:5173` with
  NAT port forwarding on guest port 5173
- Node.js 22 LTS, `node:sqlite` built-in
- Default login: `IMS-2` / `imsystem`
- DB path: `data/montrac.db` (gitignored; delete to re-seed)
