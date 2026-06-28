/**
 * trackGeometry.ts
 *
 * Arc-length utilities for the "Overall Circuit" view.
 * Uses SVGPathElement.getTotalLength() / getPointAtLength() for accurate placement
 * on arbitrary curved paths — no custom curve math required.
 */
import { useLayoutEffect, useRef, useState } from 'react';

// ── Hook ────────────────────────────────────────────────────────────────────────

/**
 * Attaches to an SVG path element and exposes its total arc length `L`.
 * Re-reads length whenever the path `d` string changes.
 *
 * Usage:
 *   const { pathRef, L } = usePathMetrics(geo.d);
 *   ...
 *   <path ref={pathRef} d={geo.d} ... />
 */
export function usePathMetrics(d: string | undefined) {
  const pathRef = useRef<SVGPathElement | null>(null);
  const [L, setL] = useState<number>(0);

  useLayoutEffect(() => {
    if (!d || !pathRef.current) {
      setL(0);
      return;
    }
    setL(pathRef.current.getTotalLength());
  }, [d]);

  return { pathRef, L };
}

// ── Pure helpers (require a mounted SVGPathElement) ──────────────────────────

/** Returns the SVG {x,y} at arc-length fraction `t ∈ [0, 1)`. */
export function pointAtT(
  path: SVGPathElement,
  t: number,
  L: number,
): { x: number; y: number } {
  const pt = path.getPointAtLength(Math.min(Math.max(t, 0), 0.9999) * L);
  return { x: pt.x, y: pt.y };
}

/** Returns the unit tangent direction at arc-length fraction `t`. */
export function tangentAtT(
  path: SVGPathElement,
  t: number,
  L: number,
): { x: number; y: number } {
  const eps = Math.max(1, L * 0.002);
  const off = Math.min(Math.max(t, 0), 0.9999) * L;
  const p1 = path.getPointAtLength(Math.max(0, off - eps));
  const p2 = path.getPointAtLength(Math.min(L * 0.9999, off + eps));
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  return { x: dx / len, y: dy / len };
}

/**
 * Computes the arc-length fraction for a shuttle between two checkpoints.
 *
 * @param fromT    t of the checkpoint the shuttle departed
 * @param toT      t of the checkpoint it is heading toward
 * @param progress 0–1 interpolation factor (computed from movedAtMs / etaMs)
 */
export function shuttleTValue(fromT: number, toT: number, progress: number): number {
  let delta = toT - fromT;
  if (delta < 0) delta += 1; // wrap across the last→first seam
  return (fromT + delta * Math.min(1, Math.max(0, progress))) % 1;
}

/**
 * Coarse-samples `path` to find the arc-length fraction closest to SVG point (x, y).
 * Used by the geometry editor to snap checkpoint clicks to the track path.
 */
export function findNearestT(
  path: SVGPathElement,
  L: number,
  x: number,
  y: number,
  samples = 600,
): number {
  let bestDist = Infinity;
  let bestLen = 0;
  for (let i = 0; i <= samples; i++) {
    const len = (i / samples) * L;
    const pt = path.getPointAtLength(len);
    const dx = pt.x - x;
    const dy = pt.y - y;
    const dist = dx * dx + dy * dy;
    if (dist < bestDist) {
      bestDist = dist;
      bestLen = len;
    }
  }
  return bestLen / L;
}

/**
 * Builds an offset copy of `srcPath` shifted perpendicular to its travel direction.
 * Returns an SVG path `d` string (M + L polyline, closed with Z) suitable for
 * rendering as a parallel ribbon and for position lookup via `getPointAtLength`.
 *
 * When `offset` is 0, returns the original `d` attribute (no approximation error).
 * The normal direction follows the right-hand rule relative to the tangent:
 *   normal = { x: -tangent.y, y: tangent.x }
 * If the ribbon lands on the wrong side, negate `offset` in your geometry config.
 *
 * @param srcPath  Mounted source SVGPathElement.
 * @param L        `srcPath.getTotalLength()`.
 * @param offset   Perpendicular shift amount in SVG user units.
 * @param samples  Number of sample points (higher = smoother ribbon on tight curves).
 */
export function buildOffsetPathD(
  srcPath: SVGPathElement,
  L: number,
  offset: number,
  samples = 240,
): string {
  if (offset === 0) return srcPath.getAttribute('d') ?? '';
  if (L === 0 || samples < 2) return '';

  const cmds: string[] = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const raw = srcPath.getPointAtLength(Math.min(Math.max(t, 0), 0.9999) * L);
    const tang = tangentAtT(srcPath, t, L);
    const nx = -tang.y * offset;
    const ny = tang.x * offset;
    const x = (raw.x + nx).toFixed(1);
    const y = (raw.y + ny).toFixed(1);
    cmds.push(i === 0 ? `M ${x} ${y}` : `L ${x} ${y}`);
  }
  cmds.push('Z');
  return cmds.join(' ');
}

/**
 * Samples `numPoints` points on the path between `fromT` and `toT`.
 * Returns an SVG polyline `points` attribute string for crash-segment highlighting.
 */
export function crashPolylinePoints(
  path: SVGPathElement,
  L: number,
  fromT: number,
  toT: number,
  numPoints = 20,
): string {
  let delta = toT - fromT;
  if (delta < 0) delta += 1;
  const pts: string[] = [];
  for (let i = 0; i <= numPoints; i++) {
    const t = (fromT + delta * (i / numPoints)) % 1;
    const pt = path.getPointAtLength(Math.min(Math.max(t, 0), 0.9999) * L);
    pts.push(`${pt.x.toFixed(1)},${pt.y.toFixed(1)}`);
  }
  return pts.join(' ');
}
