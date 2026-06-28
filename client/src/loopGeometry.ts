/**
 * loopGeometry.ts
 *
 * Static geometry config for the "Overall Circuit" view.
 * Each entry maps a loop id to its SVG path + checkpoint arc-length fractions.
 *
 * To author geometry, open /geometry in the running app, draw your loop shape,
 * place checkpoints, click Export, and paste the generated block below.
 *
 * No server / engine / DB changes needed — this is purely a client presentation layer.
 * Loops without an entry here continue to appear as ellipses in the per-loop cards.
 */


/** Shared SVG coordinate system used by ALL loops and the geometry editor canvas. */
export const TRACK_VIEWBOX = { x: 0, y: 0, w: 1000, h: 600 } as const;

/**
 * Position of one checkpoint along its loop path.
 * `t` is an arc-length fraction in [0, 1): `getPointAtLength(t * L)` gives the checkpoint's SVG position.
 * Values must be ordered in travel direction (increasing t = shuttle direction).
 */
export interface CheckpointGeometry {
  /** Arc-length fraction [0, 1). */
  t: number;
}

export interface LoopGeometry {
	
	
  /** Closed SVG path `d` string in TRACK_VIEWBOX coordinates. Must end with Z. */
  d: string;
  /** Stroke color for this loop in the circuit view. Falls back to a default if omitted. */
  color?: string;
  /**
   * Manual perpendicular ribbon offset (SVG user units) relative to the authored path.
   * Omit to use auto-centering: loops auto-space by ±RIBBON_GAP/2 so shared stretches
   * show as parallel colored ribbons. Set a negative value if the auto normal flips the
   * ribbon to the wrong side (depends on the winding direction you drew the path in).
   */
  offset?: number;
  /**
   * One entry per checkpoint, ordered by checkpoint sequence.
   * Length MUST equal the loop's checkpoint count — a mismatch causes the loop to be skipped
   * in the circuit view (it will still appear as an ellipse in the per-loop card).
   */
  checkpoints: CheckpointGeometry[];
}

/** Keyed by loop id (matches `loops.id` in the database). */
export const loopGeometry: Record<number, LoopGeometry> = {};

// Paste output from the /geometry editor here:
loopGeometry[1] = {
  d: "M 186.2 104.1 C 222.3 65.8 372.9 86.6 420.4 105.2 C 467.9 123.9 469.2 178.9 471.2 216.0 C 473.1 253.1 460.6 297.5 431.9 327.9 C 403.3 358.3 321.0 371.8 299.2 398.3 C 277.5 424.8 285.0 472.2 301.5 487.2 C 318.1 502.2 382.7 502.3 398.5 488.3 C 414.2 474.3 428.7 428.5 396.2 402.9 C 363.7 377.3 238.5 384.7 203.5 334.8 C 168.5 285.0 150.0 142.3 186.2 104.1 Z",
  color: "#2563eb",
  checkpoints: [
    { t: 0.0633 },
    { t: 0.3100 },
    { t: 0.6433 },
  ],
};

/**
 * Returns true if the geometry entry is usable for rendering.
 * Logs a warning on mismatch so the problem is visible during development.
 */
export function validateLoopGeo(geo: LoopGeometry, cpCount: number, loopId: number): boolean {
  if (!geo.d || geo.d.trim().length === 0) return false;
  if (geo.checkpoints.length !== cpCount) {
    console.warn(
      `[loopGeometry] Loop ${loopId}: checkpoint count mismatch — ` +
      `geometry has ${geo.checkpoints.length}, loop has ${cpCount}. ` +
      `This loop will be skipped in the circuit view.`,
    );
    return false;
  }
  return true;
}

/** Default per-loop stroke colors, cycled by loop index if no color is specified. */
export const LOOP_DEFAULT_COLORS = [
  '#2563eb', // blue-600
  '#16a34a', // green-600
  '#d97706', // amber-600
  '#7c3aed', // violet-600
  '#0891b2', // cyan-600
  '#dc2626', // red-600
];

// ── Shared (overlapping) checkpoints ────────────────────────────────────────

/**
 * Identifies one checkpoint within a specific loop by its 0-based sequence index.
 * Use the Circuit Editor's "Link" mode to generate these automatically.
 */
export interface SharedCheckpointRef {
  /** Loop id (matches `loops.id` in the database). */
  loopId: number;
  /** 0-based checkpoint array index (= sequence order within the loop). */
  index: number;
}

/**
 * Each inner array is one physical sensor shared across multiple loops.
 * Checkpoints in the same group are drawn as a single split-color merged marker
 * instead of separate individual circles.
 *
 * Paste this from the Circuit Editor → Link mode export.
 */
export const sharedCheckpointGroups: SharedCheckpointRef[][] = [
  // Example: CP1 of loop 1 and CP1 of loop 2 are the same physical IRM sensor
  // [{ loopId: 1, index: 0 }, { loopId: 2, index: 0 }],
];

/**
 * Validates shared checkpoint groups against the currently rendered geo loops.
 * Returns only the valid groups; logs warnings for every rejected group.
 */
export function validateSharedGroups(
  groups: SharedCheckpointRef[][],
  geoLoopIds: Set<number>,
  loopCheckpointCounts: Map<number, number>,
): SharedCheckpointRef[][] {
  const seen = new Set<string>();
  const valid: SharedCheckpointRef[][] = [];

  for (const group of groups) {
    if (group.length < 2) {
      console.warn('[loopGeometry] Shared group has fewer than 2 members — skipped:', group);
      continue;
    }
    let skip = false;
    const validMembers: SharedCheckpointRef[] = [];

    for (const ref of group) {
      const key = `${ref.loopId}:${ref.index}`;
      if (!geoLoopIds.has(ref.loopId)) {
        console.warn(`[loopGeometry] Shared group: loop ${ref.loopId} has no authored geometry — group skipped`);
        skip = true;
        break;
      }
      const cpCount = loopCheckpointCounts.get(ref.loopId) ?? 0;
      if (ref.index < 0 || ref.index >= cpCount) {
        console.warn(`[loopGeometry] Shared group: loop ${ref.loopId} index ${ref.index} out of range (0–${cpCount - 1}) — group skipped`);
        skip = true;
        break;
      }
      if (seen.has(key)) {
        console.warn(`[loopGeometry] Checkpoint ${key} appears in multiple shared groups — only the first group is kept`);
        skip = true;
        break;
      }
      validMembers.push(ref);
    }

    if (!skip) {
      validMembers.forEach((r) => seen.add(`${r.loopId}:${r.index}`));
      valid.push(validMembers);
    }
  }

  return valid;
}
