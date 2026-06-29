/**
 * Database initialisation using Node.js built-in node:sqlite (Node >=22.5)
 * Synchronous API — identical ergonomics to better-sqlite3.
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import { config } from '../config/env';

// Ensure data directory exists
const dataDir = path.dirname(config.dbPath);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

export const db = new DatabaseSync(config.dbPath);

// ─── Migrations / one-time setup ──────────────────────────────────────────────
export function initDb(): void {
  const schemaSql = fs.readFileSync(
    path.join(__dirname, 'schema.sql'),
    'utf-8',
  );
  db.exec(schemaSql);

  // Add allowed_shuttle_ids column if this is an existing DB that pre-dates it
  try {
    db.exec("ALTER TABLE loops ADD COLUMN allowed_shuttle_ids TEXT NOT NULL DEFAULT '[]'");
  } catch { /* column already exists — ignore */ }

  // Add run_id to events if this is an existing DB that pre-dates the recording feature
  try {
    db.exec('ALTER TABLE events ADD COLUMN run_id INTEGER REFERENCES recording_runs(id)');
  } catch { /* column already exists — ignore */ }

  // Mark any dangling 'recording' runs as stopped (server crashed mid-run)
  try {
    db.exec("UPDATE recording_runs SET status='stopped', ended_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE status='recording'");
  } catch { /* ignore */ }

  // Reclassify GO tags as 'readwrite' so the engine polls them (reads the PLC GO signal)
  try {
    db.exec("UPDATE tags SET direction='readwrite' WHERE logical_name IN ('IR3_AR_GO','IR2_PU4_GO')");
  } catch { /* ignore — tags may not exist yet */ }

  seedDefaultsIfEmpty();
}

function seedDefaultsIfEmpty(): void {
  // ── Default user ────────────────────────────────────────────────────────
  const userCount = (
    db.prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number }
  ).c;

  if (userCount === 0) {
    const hash = bcrypt.hashSync(config.defaultPassword, 10);
    db.prepare(
      'INSERT INTO users (username, password_hash) VALUES (?, ?)',
    ).run(config.defaultUsername, hash);
  }

  // ── Default settings ───────────────────────────────────────────────────
  const defaults: Record<string, string> = {
    opc_endpoint: config.opcEndpoint,
    mode: 'simulation',
    alarm_auto_off_ms: '30000',
    avg_speed_mm_per_sec: '200',
    light_tower_node_id: '',
    buzzer_node_id: '',
    push_button_1_node_id: '',
  };
  const upsert = db.prepare(
    'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)',
  );
  for (const [k, v] of Object.entries(defaults)) {
    upsert.run(k, v);
  }

  // ── Loop 1 ─────────────────────────────────────────────────────────────
  const loopCount = (
    db.prepare('SELECT COUNT(*) AS c FROM loops').get() as { c: number }
  ).c;

  if (loopCount === 0) {
    // Tags
    const tagInsert = db.prepare(
      `INSERT OR IGNORE INTO tags (logical_name, node_id, data_type, direction, description)
       VALUES (?, ?, ?, ?, ?)`,
    );
    const ns = 'ns=7;s=S71500ET200MP station_1.Conveyor_ctrl.';
    tagInsert.run('IR3_AR_DET',    ns + 'IR3_AR_DET',    'Boolean', 'read',      'CP1 IRM detect');
    tagInsert.run('RS232_1_BYTE2', ns + 'RS232_1.BYTE2', 'Int32',   'read',      'CP1 shuttle ID reader');
    tagInsert.run('IR3_AR_GO',     ns + 'IR3_AR_GO',     'Boolean', 'readwrite', 'CP1 IRM go signal');
    tagInsert.run('ARENA2_SIGNOFF',ns + 'ARENA2_SIGNOFF','Boolean', 'read',      'CP2 positioning sensor');
    tagInsert.run('IR2_PU4_DET',   ns + 'IR2_PU4_DET',  'Boolean', 'read',      'CP3 IRM detect');
    tagInsert.run('IR2_PU4_GO',    ns + 'IR2_PU4_GO',   'Boolean', 'readwrite', 'CP3 IRM go signal');
    tagInsert.run('LU_ARENA',      ns + 'LU_ARENA',      'Boolean', 'write',     'Arena direction: Left');
    tagInsert.run('ST_ARENA',      ns + 'ST_ARENA',      'Boolean', 'write',     'Arena direction: Straight');
    tagInsert.run('RU_ARENA',      ns + 'RU_ARENA',      'Boolean', 'write',     'Arena direction: Right');

    // Helper to get tag id by logical name
    const getTag = (name: string): number =>
      (db.prepare('SELECT id FROM tags WHERE logical_name = ?').get(name) as { id: number }).id;

    // Loop 1 — shuttle ID 2 is the only shuttle tracked on this loop
    db.prepare(
      'INSERT INTO loops (name, description, allowed_shuttle_ids) VALUES (?, ?, ?)',
    ).run('Loop 1', 'Main production loop with 3 checkpoints', '[2]');
    const loopId = (
      db.prepare('SELECT id FROM loops WHERE name = ?').get('Loop 1') as { id: number }
    ).id;

    // Checkpoints
    const cpInsert = db.prepare(
      `INSERT INTO checkpoints
         (loop_id, sequence, name, type, distance_mm_to_next, buffer_ms,
          det_tag_id, id_tag_id, go_tag_id, signoff_tag_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    cpInsert.run(loopId, 0, 'CP1 — Arena IRM (ID)', 'IRM_ID', 5000, 10000,
      getTag('IR3_AR_DET'), getTag('RS232_1_BYTE2'), getTag('IR3_AR_GO'), null);
    cpInsert.run(loopId, 1, 'CP2 — Arena Sensor', 'SENSOR', 5000, 10000,
      null, null, null, getTag('ARENA2_SIGNOFF'));
    cpInsert.run(loopId, 2, 'CP3 — Robot Station IRM', 'IRM', 5000, 10000,
      getTag('IR2_PU4_DET'), null, getTag('IR2_PU4_GO'), null);
  }

  // ── Loop 2 ─────────────────────────────────────────────────────────────
  const loopCount2 = (
    db.prepare('SELECT COUNT(*) AS c FROM loops').get() as { c: number }
  ).c;

  if (loopCount2 < 2) {
    const tagInsert2 = db.prepare(
      `INSERT OR IGNORE INTO tags (logical_name, node_id, data_type, direction, description)
       VALUES (?, ?, ?, ?, ?)`,
    );
    const ns2 = 'ns=7;s=S71500ET200MP station_1.Conveyor_ctrl.';

    // CP1 — Arena IRM_ID (IR4 side)
    tagInsert2.run('IR4_AR_DET',    ns2 + 'IR4_AR_DET',    'Boolean', 'read',      'L2 CP1 IRM detect');
    tagInsert2.run('RS232_2_BYTE2', ns2 + 'RS232_2.BYTE2', 'Int32',   'read',      'L2 CP1 shuttle ID reader');
    tagInsert2.run('IR4_AR_GO',     ns2 + 'IR4_AR_GO',     'Boolean', 'readwrite', 'L2 CP1 IRM go signal');
    // CP2 — Arena sensor
    tagInsert2.run('L2_ARENA2_SIGNOFF', ns2 + 'L2_ARENA2_SIGNOFF', 'Boolean', 'read', 'L2 CP2 positioning sensor');
    // CP3 — Robot station IRM (IR2 side)
    tagInsert2.run('L2_IR2_PU4_DET', ns2 + 'L2_IR2_PU4_DET', 'Boolean', 'read',      'L2 CP3 IRM detect');
    tagInsert2.run('L2_IR2_PU4_GO',  ns2 + 'L2_IR2_PU4_GO',  'Boolean', 'readwrite', 'L2 CP3 IRM go signal');
    // Arena tags are shared (LU_ARENA / ST_ARENA / RU_ARENA) — no per-loop arena tags needed

    const getTag2 = (name: string): number =>
      (db.prepare('SELECT id FROM tags WHERE logical_name = ?').get(name) as { id: number }).id;

    db.prepare(
      'INSERT INTO loops (name, description, allowed_shuttle_ids) VALUES (?, ?, ?)',
    ).run('Loop 2', 'Second production loop with 3 checkpoints', '[3]');
    const loop2Id = (
      db.prepare('SELECT id FROM loops WHERE name = ?').get('Loop 2') as { id: number }
    ).id;

    const cpInsert2 = db.prepare(
      `INSERT INTO checkpoints
         (loop_id, sequence, name, type, distance_mm_to_next, buffer_ms,
          det_tag_id, id_tag_id, go_tag_id, signoff_tag_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    cpInsert2.run(loop2Id, 0, 'CP1 — Arena IRM (ID)', 'IRM_ID', 5000, 10000,
      getTag2('IR4_AR_DET'), getTag2('RS232_2_BYTE2'), getTag2('IR4_AR_GO'), null);
    cpInsert2.run(loop2Id, 1, 'CP2 — Arena Sensor', 'SENSOR', 5000, 10000,
      null, null, null, getTag2('L2_ARENA2_SIGNOFF'));
    cpInsert2.run(loop2Id, 2, 'CP3 — Robot Station IRM', 'IRM', 5000, 10000,
      getTag2('L2_IR2_PU4_DET'), null, getTag2('L2_IR2_PU4_GO'), null);
  }

  // ── Loop 3 ─── crossover loop; OWN tags duplicate L1/L2 sensor addresses ─────
  const loopCount3 = (
    db.prepare('SELECT COUNT(*) AS c FROM loops').get() as { c: number }
  ).c;

  if (loopCount3 < 3) {
    // Read an existing tag's node_id so the L3 duplicates point at the same address.
    const getNode = (name: string): string =>
      (db.prepare('SELECT node_id FROM tags WHERE logical_name = ?').get(name) as { node_id: string }).node_id;

    // Duplicate tag rows: new logical_name, SAME node_id (address) as the original.
    const tagInsert3 = db.prepare(
      `INSERT OR IGNORE INTO tags (logical_name, node_id, data_type, direction, description)
       VALUES (?, ?, ?, ?, ?)`,
    );
    // seq 0 — duplicates Loop 1 CP1 (IRM_ID)
    tagInsert3.run('L3_IR3_AR_DET',    getNode('IR3_AR_DET'),    'Boolean', 'read',      'L3 CP1 IRM detect (addr shared w/ L1 CP1)');
    tagInsert3.run('L3_RS232_1_BYTE2', getNode('RS232_1_BYTE2'), 'Int32',   'read',      'L3 CP1 shuttle ID reader (addr shared w/ L1 CP1)');
    tagInsert3.run('L3_IR3_AR_GO',     getNode('IR3_AR_GO'),     'Boolean', 'readwrite', 'L3 CP1 IRM go signal (addr shared w/ L1 CP1)');
    // seq 1 — duplicates Loop 2 CP2 (SENSOR)
    tagInsert3.run('L3_L2_ARENA2_SIGNOFF', getNode('L2_ARENA2_SIGNOFF'), 'Boolean', 'read', 'L3 CP2 positioning sensor (addr shared w/ L2 CP2)');
    // seq 2 — duplicates Loop 2 CP1 (IRM_ID)
    tagInsert3.run('L3_IR4_AR_DET',    getNode('IR4_AR_DET'),    'Boolean', 'read',      'L3 CP3 IRM detect (addr shared w/ L2 CP1)');
    tagInsert3.run('L3_RS232_2_BYTE2', getNode('RS232_2_BYTE2'), 'Int32',   'read',      'L3 CP3 shuttle ID reader (addr shared w/ L2 CP1)');
    tagInsert3.run('L3_IR4_AR_GO',     getNode('IR4_AR_GO'),     'Boolean', 'readwrite', 'L3 CP3 IRM go signal (addr shared w/ L2 CP1)');
    // seq 3 — duplicates Loop 1 CP2 (SENSOR)
    tagInsert3.run('L3_ARENA2_SIGNOFF', getNode('ARENA2_SIGNOFF'), 'Boolean', 'read', 'L3 CP4 positioning sensor (addr shared w/ L1 CP2)');

    const getTag3 = (name: string): number =>
      (db.prepare('SELECT id FROM tags WHERE logical_name = ?').get(name) as { id: number }).id;

    db.prepare(
      'INSERT INTO loops (name, description, allowed_shuttle_ids) VALUES (?, ?, ?)',
    ).run('Loop 3', 'Crossover loop spanning both arenas (shuttle 255)', '[255]');
    const loop3Id = (
      db.prepare('SELECT id FROM loops WHERE name = ?').get('Loop 3') as { id: number }
    ).id;

    const cpInsert3 = db.prepare(
      `INSERT INTO checkpoints
         (loop_id, sequence, name, type, distance_mm_to_next, buffer_ms,
          det_tag_id, id_tag_id, go_tag_id, signoff_tag_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    // seq 0 = Loop 1 CP1 mirror (IRM_ID)
    cpInsert3.run(loop3Id, 0, 'CP1 — Arena IRM (ID) [L1]', 'IRM_ID', 5000, 10000,
      getTag3('L3_IR3_AR_DET'), getTag3('L3_RS232_1_BYTE2'), getTag3('L3_IR3_AR_GO'), null);
    // seq 1 = Loop 2 CP2 mirror (SENSOR)
    cpInsert3.run(loop3Id, 1, 'CP2 — Arena Sensor [L2]', 'SENSOR', 5000, 10000,
      null, null, null, getTag3('L3_L2_ARENA2_SIGNOFF'));
    // seq 2 = Loop 2 CP1 mirror (IRM_ID)
    cpInsert3.run(loop3Id, 2, 'CP3 — Arena IRM (ID) [L2]', 'IRM_ID', 5000, 10000,
      getTag3('L3_IR4_AR_DET'), getTag3('L3_RS232_2_BYTE2'), getTag3('L3_IR4_AR_GO'), null);
    // seq 3 = Loop 1 CP2 mirror (SENSOR)
    cpInsert3.run(loop3Id, 3, 'CP4 — Arena Sensor [L1]', 'SENSOR', 5000, 10000,
      null, null, null, getTag3('L3_ARENA2_SIGNOFF'));
  }
}
