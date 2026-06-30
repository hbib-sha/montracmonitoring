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

// ── Geometry derived from circuit.png ────────────────────────────────────────
// Loops 1 & 2 are tall rounded loops (top lobe + bottom box) on the left/right;
// Loop 3 is the wide yellow crossover ring across the top. The four shared
// junction sensors (CP1 L1, CP2 L2, CP1 L2, CP2 L1) are authored at identical
// coordinates across the loops that share them, so they render as merged
// split-color markers (see sharedCheckpointGroups below).
loopGeometry[1] = {
  d: "M 355.0 110.0 L 366.7 110.0 L 378.3 110.0 L 390.0 110.0 L 402.2 111.1 L 413.9 114.2 L 425.0 119.4 L 435.0 126.4 L 443.6 135.0 L 450.6 145.0 L 455.8 156.1 L 458.9 167.8 L 460.0 180.0 L 460.0 192.0 L 460.0 204.1 L 460.0 216.1 L 460.0 228.1 L 460.0 240.2 L 460.0 252.2 L 460.0 264.3 L 460.0 276.3 L 460.0 288.3 L 460.0 300.4 L 460.0 312.4 L 460.0 324.4 L 460.0 336.5 L 460.0 348.5 L 460.0 360.6 L 460.0 372.6 L 460.0 384.6 L 460.0 396.7 L 460.0 408.7 L 460.0 420.7 L 460.0 432.8 L 460.0 444.8 L 460.0 456.9 L 460.0 468.9 L 460.0 480.9 L 460.0 493.0 L 460.0 505.0 L 458.9 517.2 L 455.8 528.9 L 450.6 540.0 L 443.6 550.0 L 435.0 558.6 L 425.0 565.6 L 413.9 570.8 L 402.2 573.9 L 390.0 575.0 L 378.3 575.0 L 366.7 575.0 L 355.0 575.0 L 343.3 575.0 L 331.7 575.0 L 320.0 575.0 L 307.8 573.9 L 296.1 570.8 L 285.0 565.6 L 275.0 558.6 L 266.4 550.0 L 259.4 540.0 L 254.2 528.9 L 251.1 517.2 L 250.0 505.0 L 250.0 493.0 L 250.0 480.9 L 250.0 468.9 L 250.0 456.9 L 250.0 444.8 L 250.0 432.8 L 250.0 420.7 L 250.0 408.7 L 250.0 396.7 L 250.0 384.6 L 250.0 372.6 L 250.0 360.6 L 250.0 348.5 L 250.0 336.5 L 250.0 324.4 L 250.0 312.4 L 250.0 300.4 L 250.0 288.3 L 250.0 276.3 L 250.0 264.3 L 250.0 252.2 L 250.0 240.2 L 250.0 228.1 L 250.0 216.1 L 250.0 204.1 L 250.0 192.0 L 250.0 180.0 L 251.1 167.8 L 254.2 156.1 L 259.4 145.0 L 266.4 135.0 L 275.0 126.4 L 285.0 119.4 L 296.1 114.2 L 307.8 111.1 L 320.0 110.0 L 331.7 110.0 L 343.3 110.0 Z",
  color: "#22c55e",
  checkpoints: [{ t: 0 }, { t: 0.2647 }, { t: 0.5 }],
};
loopGeometry[2] = {
  d: "M 555.0 360.6 L 555.0 348.5 L 555.0 336.5 L 555.0 324.4 L 555.0 312.4 L 555.0 300.4 L 555.0 288.3 L 555.0 276.3 L 555.0 264.3 L 555.0 252.2 L 555.0 240.2 L 555.0 228.1 L 555.0 216.1 L 555.0 204.1 L 555.0 192.0 L 555.0 180.0 L 556.1 167.8 L 559.2 156.1 L 564.4 145.0 L 571.4 135.0 L 580.0 126.4 L 590.0 119.4 L 601.1 114.2 L 612.8 111.1 L 625.0 110.0 L 636.7 110.0 L 648.3 110.0 L 660.0 110.0 L 671.7 110.0 L 683.3 110.0 L 695.0 110.0 L 707.2 111.1 L 718.9 114.2 L 730.0 119.4 L 740.0 126.4 L 748.6 135.0 L 755.6 145.0 L 760.8 156.1 L 763.9 167.8 L 765.0 180.0 L 765.0 192.0 L 765.0 204.1 L 765.0 216.1 L 765.0 228.1 L 765.0 240.2 L 765.0 252.2 L 765.0 264.3 L 765.0 276.3 L 765.0 288.3 L 765.0 300.4 L 765.0 312.4 L 765.0 324.4 L 765.0 336.5 L 765.0 348.5 L 765.0 360.6 L 765.0 372.6 L 765.0 384.6 L 765.0 396.7 L 765.0 408.7 L 765.0 420.7 L 765.0 432.8 L 765.0 444.8 L 765.0 456.9 L 765.0 468.9 L 765.0 480.9 L 765.0 493.0 L 765.0 505.0 L 763.9 517.2 L 760.8 528.9 L 755.6 540.0 L 748.6 550.0 L 740.0 558.6 L 730.0 565.6 L 718.9 570.8 L 707.2 573.9 L 695.0 575.0 L 683.3 575.0 L 671.7 575.0 L 660.0 575.0 L 648.3 575.0 L 636.7 575.0 L 625.0 575.0 L 612.8 573.9 L 601.1 570.8 L 590.0 565.6 L 580.0 558.6 L 571.4 550.0 L 564.4 540.0 L 559.2 528.9 L 556.1 517.2 L 555.0 505.0 L 555.0 493.0 L 555.0 480.9 L 555.0 468.9 L 555.0 456.9 L 555.0 444.8 L 555.0 432.8 L 555.0 420.7 L 555.0 408.7 L 555.0 396.7 L 555.0 384.6 L 555.0 372.6 Z",
  color: "#ef4444",
  checkpoints: [{ t: 0 }, { t: 0.2647 }, { t: 0.7647 }],
};
loopGeometry[3] = {
  d: "M 349.5 110.0 L 361.5 110.0 L 373.6 110.0 L 385.6 110.0 L 397.7 110.0 L 409.7 110.0 L 421.7 110.0 L 433.8 110.0 L 445.8 110.0 L 457.9 110.0 L 469.9 110.0 L 481.9 110.0 L 494.0 110.0 L 506.0 110.0 L 518.1 110.0 L 530.1 110.0 L 542.1 110.0 L 554.2 110.0 L 566.2 110.0 L 578.3 110.0 L 590.3 110.0 L 602.3 110.0 L 614.4 110.0 L 626.4 110.0 L 638.5 110.0 L 650.5 110.0 L 662.6 110.0 L 674.6 110.0 L 686.6 110.0 L 698.7 110.0 L 710.7 110.0 L 722.8 110.0 L 734.8 110.0 L 746.8 110.0 L 758.9 110.0 L 770.9 110.0 L 783.0 110.0 L 795.0 110.0 L 807.3 110.6 L 819.4 112.4 L 831.3 115.4 L 842.8 119.5 L 853.9 124.8 L 864.4 131.1 L 874.3 138.4 L 883.4 146.6 L 891.6 155.7 L 898.9 165.6 L 905.2 176.1 L 910.5 187.2 L 914.6 198.7 L 917.6 210.6 L 919.4 222.7 L 920.0 235.0 L 919.4 247.3 L 917.6 259.4 L 914.6 271.3 L 910.5 282.8 L 905.2 293.9 L 898.9 304.4 L 891.6 314.3 L 883.4 323.4 L 874.3 331.6 L 864.4 338.9 L 853.9 345.2 L 842.8 350.5 L 831.3 354.6 L 819.4 357.6 L 807.3 359.4 L 795.0 360.0 L 783.0 360.0 L 770.9 360.0 L 758.9 360.0 L 746.8 360.0 L 734.8 360.0 L 722.8 360.0 L 710.7 360.0 L 698.7 360.0 L 686.6 360.0 L 674.6 360.0 L 662.6 360.0 L 650.5 360.0 L 638.5 360.0 L 626.4 360.0 L 614.4 360.0 L 602.3 360.0 L 590.3 360.0 L 578.3 360.0 L 566.2 360.0 L 554.2 360.0 L 542.1 360.0 L 530.1 360.0 L 518.1 360.0 L 506.0 360.0 L 494.0 360.0 L 481.9 360.0 L 469.9 360.0 L 457.9 360.0 L 445.8 360.0 L 433.8 360.0 L 421.7 360.0 L 409.7 360.0 L 397.7 360.0 L 385.6 360.0 L 373.6 360.0 L 361.5 360.0 L 349.5 360.0 L 337.4 360.0 L 325.4 360.0 L 313.4 360.0 L 301.3 360.0 L 289.3 360.0 L 277.2 360.0 L 265.2 360.0 L 253.2 360.0 L 241.1 360.0 L 229.1 360.0 L 217.0 360.0 L 205.0 360.0 L 192.7 359.4 L 180.6 357.6 L 168.7 354.6 L 157.2 350.5 L 146.1 345.2 L 135.6 338.9 L 125.7 331.6 L 116.6 323.4 L 108.4 314.3 L 101.1 304.4 L 94.8 293.9 L 89.5 282.8 L 85.4 271.3 L 82.4 259.4 L 80.6 247.3 L 80.0 235.0 L 80.6 222.7 L 82.4 210.6 L 85.4 198.7 L 89.5 187.2 L 94.8 176.1 L 101.1 165.6 L 108.4 155.7 L 116.6 146.6 L 125.7 138.4 L 135.6 131.1 L 146.1 124.8 L 157.2 119.5 L 168.7 115.4 L 180.6 112.4 L 192.7 110.6 L 205.0 110.0 L 217.0 110.0 L 229.1 110.0 L 241.1 110.0 L 253.2 110.0 L 265.2 110.0 L 277.2 110.0 L 289.3 110.0 L 301.3 110.0 L 313.4 110.0 L 325.4 110.0 L 337.4 110.0 Z",
  color: "#eab308",
  checkpoints: [{ t: 0 }, { t: 0.1593 }, { t: 0.549 }, { t: 0.598 }],
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
  // The 4 crossover sensors Loop 3 mirrors from Loops 1 & 2 (see DB seed).
  [{ loopId: 1, index: 0 }, { loopId: 3, index: 0 }], // CP1 L1 (IRM_ID)  — top-left junction
  [{ loopId: 2, index: 1 }, { loopId: 3, index: 1 }], // CP2 L2 (SENSOR)  — top-right junction
  [{ loopId: 2, index: 0 }, { loopId: 3, index: 2 }], // CP1 L2 (IRM_ID)  — mid-right junction
  [{ loopId: 1, index: 1 }, { loopId: 3, index: 3 }], // CP2 L1 (SENSOR)  — mid-left junction
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
