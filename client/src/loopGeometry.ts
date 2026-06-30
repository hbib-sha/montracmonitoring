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
// Loops 1 & 2 are smoothed free-form shapes (loop 2 = loop 1 mirrored across x=505.5);
// Loop 3 is the wide yellow crossover ring across the top. The four shared
// junction sensors (CP1 L1, CP2 L2, CP1 L2, CP2 L1) are authored at identical
// coordinates across the loops that share them, so they render as merged
// split-color markers (see sharedCheckpointGroups below).
loopGeometry[1] = {
  d: "M 199.0 113.6 L 213.7 111.9 L 228.5 110.8 L 243.4 110.2 L 258.3 109.8 L 273.2 109.7 L 288.1 109.6 L 303.0 109.7 L 317.9 109.8 L 332.8 109.9 L 347.7 110.0 L 362.6 110.1 L 377.4 110.2 L 392.3 110.4 L 407.2 111.2 L 421.9 112.9 L 436.2 116.0 L 449.9 121.0 L 462.5 127.9 L 473.7 137.0 L 483.1 147.8 L 490.8 160.2 L 496.7 173.6 L 501.0 187.7 L 503.8 202.2 L 505.3 216.8 L 505.5 231.6 L 504.4 246.3 L 501.9 260.9 L 498.0 275.1 L 492.8 288.9 L 486.2 302.1 L 478.2 314.4 L 468.8 325.6 L 458.0 335.5 L 446.0 343.7 L 433.0 350.2 L 419.1 354.8 L 404.7 357.9 L 390.0 359.7 L 375.2 360.5 L 360.3 360.7 L 345.4 360.6 L 330.5 360.5 L 315.6 360.7 L 300.8 361.4 L 286.1 363.0 L 271.5 365.7 L 257.5 369.8 L 244.2 375.8 L 232.3 383.8 L 222.0 393.7 L 213.8 405.4 L 207.8 418.6 L 204.0 432.6 L 202.3 447.1 L 202.6 461.7 L 204.8 476.2 L 208.8 490.3 L 214.8 503.6 L 222.8 515.6 L 232.7 525.9 L 244.3 534.4 L 257.3 540.8 L 271.2 545.4 L 285.7 548.4 L 300.4 550.2 L 315.2 551.2 L 330.1 551.7 L 345.0 551.9 L 359.8 552.1 L 374.7 552.3 L 389.6 552.5 L 404.5 552.3 L 419.3 551.4 L 433.7 549.0 L 447.3 544.6 L 459.4 537.6 L 469.4 528.0 L 476.8 516.2 L 481.7 502.7 L 484.2 488.4 L 484.7 473.7 L 483.4 459.1 L 480.3 444.8 L 475.2 431.2 L 467.9 418.9 L 458.5 408.1 L 447.2 399.1 L 434.5 392.0 L 420.9 386.6 L 406.7 382.4 L 392.2 379.2 L 377.5 376.6 L 362.8 374.6 L 348.0 372.9 L 333.2 371.4 L 318.4 370.0 L 303.5 368.6 L 288.7 367.2 L 273.9 365.7 L 259.1 364.2 L 244.3 362.6 L 229.5 360.8 L 214.8 358.7 L 200.1 356.0 L 185.6 352.9 L 171.3 348.9 L 157.4 343.9 L 144.1 337.6 L 131.6 330.0 L 120.1 320.9 L 109.9 310.4 L 101.2 298.7 L 94.1 285.9 L 88.8 272.3 L 85.4 258.0 L 83.9 243.5 L 84.2 228.8 L 86.3 214.3 L 90.1 200.1 L 95.6 186.5 L 102.5 173.5 L 110.8 161.4 L 120.5 150.4 L 131.5 140.6 L 143.5 132.3 L 156.4 125.4 L 170.2 120.1 L 184.4 116.3 Z",
  color: "#22c55e",
  checkpoints: [{ t: 0.0936 }, { t: 0.2933 }, { t: 0.6223 }],
};
loopGeometry[2] = {
  d: "M 826.7 116.3 L 840.9 120.1 L 854.6 125.4 L 867.6 132.3 L 879.6 140.6 L 890.5 150.4 L 900.2 161.4 L 908.6 173.5 L 915.5 186.5 L 921.0 200.1 L 924.8 214.3 L 926.9 228.8 L 927.2 243.5 L 925.7 258.0 L 922.2 272.3 L 916.9 285.9 L 909.9 298.7 L 901.2 310.4 L 891.0 320.9 L 879.5 330.0 L 867.0 337.6 L 853.7 343.9 L 839.8 348.9 L 825.5 352.9 L 811.0 356.0 L 796.3 358.7 L 781.6 360.8 L 766.8 362.6 L 752.0 364.2 L 737.2 365.7 L 722.4 367.2 L 707.5 368.6 L 692.7 370.0 L 677.9 371.4 L 663.1 372.9 L 648.3 374.6 L 633.5 376.6 L 618.9 379.2 L 604.4 382.4 L 590.2 386.6 L 576.5 392.0 L 563.8 399.1 L 552.6 408.1 L 543.2 418.9 L 535.9 431.2 L 530.7 444.8 L 527.6 459.1 L 526.3 473.7 L 526.8 488.4 L 529.4 502.7 L 534.3 516.2 L 541.7 528.0 L 551.6 537.6 L 563.7 544.6 L 577.3 549.0 L 591.8 551.4 L 606.6 552.3 L 621.4 552.5 L 636.3 552.3 L 651.2 552.1 L 666.1 551.9 L 681.0 551.7 L 695.9 551.2 L 710.7 550.2 L 725.4 548.4 L 739.8 545.4 L 753.8 540.8 L 766.7 534.4 L 778.3 525.9 L 788.2 515.6 L 796.2 503.6 L 802.3 490.3 L 806.3 476.2 L 808.4 461.7 L 808.7 447.1 L 807.0 432.6 L 803.2 418.6 L 797.2 405.4 L 789.1 393.7 L 778.8 383.8 L 766.9 375.8 L 753.6 369.8 L 739.5 365.7 L 725.0 363.0 L 710.3 361.4 L 695.4 360.7 L 680.5 360.5 L 665.7 360.6 L 650.8 360.7 L 635.9 360.5 L 621.1 359.7 L 606.4 357.9 L 592.0 354.8 L 578.1 350.2 L 565.0 343.7 L 553.0 335.5 L 542.3 325.6 L 532.9 314.4 L 524.9 302.1 L 518.3 288.9 L 513.1 275.1 L 509.2 260.9 L 506.7 246.3 L 505.5 231.6 L 505.7 216.8 L 507.2 202.2 L 510.1 187.7 L 514.4 173.6 L 520.3 160.2 L 527.9 147.8 L 537.4 137.0 L 548.6 127.9 L 561.2 121.0 L 574.9 116.0 L 589.2 112.9 L 603.9 111.2 L 618.7 110.4 L 633.6 110.2 L 648.5 110.1 L 663.4 110.0 L 678.3 109.9 L 693.2 109.8 L 708.1 109.7 L 723.0 109.6 L 737.9 109.7 L 752.8 109.8 L 767.7 110.2 L 782.5 110.8 L 797.4 111.9 L 812.1 113.6 Z",
  color: "#ef4444",
  checkpoints: [{ t: 0.699 }, { t: 0.8987 }, { t: 0.37 }],
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
  // Temporarily disabled: Loop 2 is now a literal vertical mirror of Loop 1, so
  // its CP1/CP2 sit at different spots than Loop 3's crossover ring expects.
  // Re-enable (and rebuild Loop 3 to match) once the crossover shape is updated.
  // [{ loopId: 1, index: 0 }, { loopId: 3, index: 0 }], // CP1 L1 (IRM_ID)
  // [{ loopId: 2, index: 1 }, { loopId: 3, index: 1 }], // CP2 L2 (SENSOR)
  // [{ loopId: 2, index: 0 }, { loopId: 3, index: 2 }], // CP1 L2 (IRM_ID)
  // [{ loopId: 1, index: 1 }, { loopId: 3, index: 3 }], // CP2 L1 (SENSOR)
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
