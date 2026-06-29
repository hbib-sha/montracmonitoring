-- Montrac Monitoring System — SQLite Schema
-- Applied once on first boot via db/index.ts

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ── Users ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT    NOT NULL UNIQUE,
  password_hash TEXT    NOT NULL,
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- ── Global Settings (key/value) ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- ── OPC UA Tags ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tags (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  logical_name TEXT    NOT NULL UNIQUE,
  node_id      TEXT    NOT NULL,
  data_type    TEXT    NOT NULL DEFAULT 'Boolean',  -- Boolean | Int32 | Float | String
  direction    TEXT    NOT NULL DEFAULT 'read',     -- read | write | readwrite
  description  TEXT    NOT NULL DEFAULT ''
);

-- ── Loops ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS loops (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  name                TEXT    NOT NULL,
  description         TEXT    NOT NULL DEFAULT '',
  allowed_shuttle_ids TEXT    NOT NULL DEFAULT '[]'  -- JSON array of tracked shuttle IDs, e.g. [2]
);

-- ── Checkpoints ───────────────────────────────────────────────────────────────
-- sequence: 0-based order within the loop (ring: last → first)
CREATE TABLE IF NOT EXISTS checkpoints (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  loop_id             INTEGER NOT NULL REFERENCES loops(id),
  sequence            INTEGER NOT NULL,
  name                TEXT    NOT NULL,
  type                TEXT    NOT NULL,   -- IRM_ID | IRM | SENSOR
  distance_mm_to_next INTEGER NOT NULL DEFAULT 5000,
  buffer_ms           INTEGER NOT NULL DEFAULT 10000,
  det_tag_id          INTEGER REFERENCES tags(id),      -- IRM / IRM_ID detect
  id_tag_id           INTEGER REFERENCES tags(id),      -- IRM_ID shuttle ID reader
  go_tag_id           INTEGER REFERENCES tags(id),      -- IRM / IRM_ID go output
  signoff_tag_id      INTEGER REFERENCES tags(id),      -- SENSOR signoff
  UNIQUE(loop_id, sequence)
);

-- ── Crash / Alarm Events ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  loop_id         INTEGER NOT NULL REFERENCES loops(id),
  segment_from    INTEGER NOT NULL,  -- checkpoint sequence
  segment_to      INTEGER NOT NULL,
  created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  resolved_at     TEXT,
  acknowledged    INTEGER NOT NULL DEFAULT 0,
  run_id          INTEGER REFERENCES recording_runs(id)
);

-- ── Recording Runs ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS recording_runs (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  name                TEXT    NOT NULL,
  started_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ended_at            TEXT,
  status              TEXT    NOT NULL DEFAULT 'recording',  -- recording | stopped
  mode                TEXT    NOT NULL DEFAULT 'simulation', -- real | simulation
  sample_interval_ms  INTEGER NOT NULL DEFAULT 1000,
  notes               TEXT    NOT NULL DEFAULT ''
);

-- ── Recording Samples (1/s snapshots) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS recording_samples (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id                INTEGER NOT NULL REFERENCES recording_runs(id) ON DELETE CASCADE,
  t                     INTEGER NOT NULL,  -- epoch ms
  connected             INTEGER NOT NULL DEFAULT 0,
  mode                  TEXT    NOT NULL DEFAULT 'simulation',
  active_shuttle_count  INTEGER NOT NULL DEFAULT 0,
  crashed_count         INTEGER NOT NULL DEFAULT 0,
  snapshot_json         TEXT    NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_samples_run_t ON recording_samples(run_id, t);

-- ── Segment Timings (ETA accuracy per shuttle transit) ────────────────────────
CREATE TABLE IF NOT EXISTS segment_timings (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id            INTEGER NOT NULL REFERENCES recording_runs(id) ON DELETE CASCADE,
  loop_id           INTEGER NOT NULL,
  shuttle_id        INTEGER NOT NULL,
  from_index        INTEGER NOT NULL,
  to_index          INTEGER NOT NULL,
  predicted_eta_ms  INTEGER NOT NULL,
  actual_elapsed_ms INTEGER NOT NULL,
  recorded_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- ── Crash Markers (ground-truth vs detected latency) ─────────────────────────
CREATE TABLE IF NOT EXISTS crash_markers (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id                INTEGER NOT NULL REFERENCES recording_runs(id) ON DELETE CASCADE,
  loop_id               INTEGER NOT NULL,
  actual_crash_at_ms    INTEGER NOT NULL,  -- epoch ms user provided
  detected_event_id     INTEGER REFERENCES events(id),
  detected_at_ms        INTEGER,           -- epoch ms of detected crash
  detection_latency_ms  INTEGER,           -- detected_at_ms - actual_crash_at_ms
  note                  TEXT    NOT NULL DEFAULT '',
  created_at            TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
