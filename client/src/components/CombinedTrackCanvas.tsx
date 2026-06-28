/**
 * CombinedTrackCanvas
 *
 * Renders all loops that have authored geometry onto ONE shared SVG canvas:
 *   • Each loop's track is drawn as a parallel ribbon offset perpendicular to its
 *     path direction, so loops that physically share a stretch appear as distinct
 *     colored ribbons rather than painting over each other.
 *   • Checkpoints and shuttles ride each loop's offset ribbon automatically.
 *   • Checkpoints declared as shared sensors (sharedCheckpointGroups) are merged
 *     into a single split-color ring marker instead of separate overlapping circles.
 *   • Shuttles animate at ~15 fps via a single shared requestAnimationFrame.
 *
 * Loops without geometry in loopGeometry.ts are NOT shown here.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { LoopState, VirtualShuttleState } from '../../../server/src/types';
import {
  TRACK_VIEWBOX,
  loopGeometry,
  validateLoopGeo,
  validateSharedGroups,
  sharedCheckpointGroups,
  LOOP_DEFAULT_COLORS,
  type LoopGeometry,
} from '../loopGeometry';
import {
  buildOffsetPathD,
  crashPolylinePoints,
  shuttleTValue,
  tangentAtT,
  pointAtT,
} from '../lib/trackGeometry';
import { socket } from '../lib/socket';

// ── Visual constants (SVG user units) ────────────────────────────────────────
const CP_R         = 14;   // checkpoint circle radius
const TRACK_W      = 5;    // normal track stroke width
const CRASH_W      = 9;    // crashed segment overlay width
const SHUTTLE_R    = 11;   // shuttle marker radius
const PARK_OFFSET  = 28;   // perpendicular offset for stopped/crashed shuttles
const RIBBON_GAP   = 8;    // gap between auto-centered loop ribbons

const CP_FILL        = '#ffffff';
const CP_DETECT      = '#16a34a';
const CP_CRASH_COLOR = '#dc2626';
const TEXT_NORMAL    = '#64748b';
const TEXT_DETECT    = '#16a34a';
const TEXT_CRASH     = '#dc2626';
const SHUTTLE_MOVE   = '#2563eb';
const SHUTTLE_STOP   = '#d97706';
const SHUTTLE_DEAD   = '#dc2626';
const TRACK_CRASH    = '#dc2626';

// ── Arc helper for split-color rings ────────────────────────────────────────

/** Returns an SVG arc path from startDeg→endDeg (clockwise, degrees). */
function arcSegmentPath(
  cx: number, cy: number, r: number,
  startDeg: number, endDeg: number,
): string {
  const rad = (d: number) => (d * Math.PI) / 180;
  const x1 = cx + r * Math.cos(rad(startDeg));
  const y1 = cy + r * Math.sin(rad(startDeg));
  const x2 = cx + r * Math.cos(rad(endDeg));
  const y2 = cy + r * Math.sin(rad(endDeg));
  const spanDeg = Math.abs(endDeg - startDeg);
  const largeArc = spanDeg > 180 ? 1 : 0;
  // sweep-flag=1 = clockwise
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${largeArc} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

// ── LoopLayer — one loop's SVG content (tracks + checkpoints + shuttles) ────

interface LoopLayerProps {
  loop: LoopState;
  geo: LoopGeometry;
  color: string;
  offsetAmount: number;                // perpendicular ribbon shift (user units)
  tick: number;                        // bumped each animation frame
  groupedCheckpointIndices: Set<number>; // checkpoint indices handled by parent as merged markers
  onPathMeasured: (loopId: number, path: SVGPathElement, L: number) => void;
}

function LoopLayer({
  loop, geo, color, offsetAmount, tick,
  groupedCheckpointIndices, onPathMeasured,
}: LoopLayerProps) {
  // Stage 1: source path → compute L → derive offset path D
  const srcPathRef = useRef<SVGPathElement | null>(null);
  const [offsetD,  setOffsetD]  = useState('');

  useLayoutEffect(() => {
    if (!srcPathRef.current) return;
    const srcL = srcPathRef.current.getTotalLength();
    setOffsetD(buildOffsetPathD(srcPathRef.current, srcL, offsetAmount));
  }, [geo.d, offsetAmount]);

  // Stage 2: offset path mounted → measure its L → notify parent
  const offPathRef = useRef<SVGPathElement | null>(null);
  const [offL, setOffL] = useState(0);

  useLayoutEffect(() => {
    if (!offPathRef.current || !offsetD) return;
    const L = offPathRef.current.getTotalLength();
    setOffL(L);
    onPathMeasured(loop.id, offPathRef.current, L);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offsetD]); // onPathMeasured is stable (useCallback in parent)

  void tick; // used to force re-render at animation rate

  const n   = loop.checkpoints.length;
  const cpTs = geo.checkpoints.map((c) => c.t);

  function point(t: number) {
    if (!offPathRef.current || offL === 0) return { x: 0, y: 0 };
    return pointAtT(offPathRef.current, t, offL);
  }

  function normalAt(t: number): { x: number; y: number } {
    if (!offPathRef.current || offL === 0) return { x: 0, y: 1 };
    const tang = tangentAtT(offPathRef.current, t, offL);
    return { x: -tang.y, y: tang.x }; // 90° CW
  }

  function shuttlePos(shuttle: VirtualShuttleState): { x: number; y: number } {
    const fromT = cpTs[shuttle.checkpointIndex];
    const toT   = cpTs[(shuttle.checkpointIndex + 1) % n];
    if (shuttle.status === 'moving' && shuttle.movedAtMs && shuttle.etaMs) {
      const progress = Math.min(1, (Date.now() - shuttle.movedAtMs) / shuttle.etaMs);
      return point(shuttleTValue(fromT, toT, progress));
    }
    // Stopped / crashed — park perpendicular to ribbon at the checkpoint
    const base = point(fromT);
    const nor  = normalAt(fromT);
    return { x: base.x + nor.x * PARK_OFFSET, y: base.y + nor.y * PARK_OFFSET };
  }

  return (
    <g>
      {/* ── Hidden source path: only for geometry computation ── */}
      <path ref={srcPathRef} d={geo.d} fill="none" stroke="none" />

      {/* ── Visible offset (ribbon) track ── */}
      {offsetD && (
        <path
          ref={offPathRef}
          d={offsetD}
          fill="none"
          stroke={color}
          strokeWidth={TRACK_W}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={0.8}
        />
      )}

      {/* ── Crash segment overlays ── */}
      {offL > 0 && offPathRef.current && loop.crashedSegments.map((seg) => {
        const pts = crashPolylinePoints(
          offPathRef.current!, offL,
          cpTs[seg.fromIndex], cpTs[seg.toIndex],
        );
        return (
          <g key={`crash-${seg.fromIndex}-${seg.toIndex}`}>
            <polyline points={pts} fill="none" stroke={TRACK_CRASH}
              strokeWidth={CRASH_W} strokeLinecap="round" />
            <polyline points={pts} fill="none" stroke={TRACK_CRASH}
              strokeWidth={CRASH_W + 6} strokeLinecap="round" opacity={0.25} />
          </g>
        );
      })}

      {/* ── Checkpoint circles (skip those in shared groups) ── */}
      {offL > 0 && loop.checkpoints.map((cp, i) => {
        if (groupedCheckpointIndices.has(i)) return null;

        const { x, y }    = point(cpTs[i]);
        const isCrashFrom = loop.crashedSegments.some((s) => s.fromIndex === i);
        const isCrashTo   = loop.crashedSegments.some((s) => s.toIndex   === i);
        const highlight   = isCrashFrom || isCrashTo;
        const strokeColor = highlight ? CP_CRASH_COLOR : cp.detecting ? CP_DETECT : color;
        const textColor   = highlight ? TEXT_CRASH : cp.detecting ? TEXT_DETECT : TEXT_NORMAL;

        return (
          <g key={cp.id}>
            {cp.detecting && (
              <circle cx={x} cy={y} r={CP_R + 9} fill="none"
                stroke={CP_DETECT} strokeWidth={2} opacity={0.35} />
            )}
            <circle cx={x} cy={y} r={CP_R}
              fill={highlight ? '#fef2f2' : CP_FILL} stroke={strokeColor} strokeWidth={2.5} />
            <text x={x} y={y - 2} textAnchor="middle" dominantBaseline="middle"
              fontSize="9" fontWeight="bold" fill={textColor}>
              {i + 1}
            </text>
            <text x={x} y={y + 8} textAnchor="middle" dominantBaseline="middle"
              fontSize="5" fill={highlight ? TEXT_CRASH : '#94a3b8'}>
              {cp.type}
            </text>
          </g>
        );
      })}

      {/* ── Shuttle markers ── */}
      {offL > 0 && loop.shuttles.map((s) => {
        const pos = shuttlePos(s);
        const col =
          s.status === 'crashed' ? SHUTTLE_DEAD :
          s.status === 'stopped' ? SHUTTLE_STOP :
          SHUTTLE_MOVE;
        return (
          <g key={s.id}>
            <circle cx={pos.x} cy={pos.y} r={SHUTTLE_R} fill={col} opacity={0.9} />
            <text x={pos.x} y={pos.y + 1} textAnchor="middle" dominantBaseline="middle"
              fontSize="8" fontWeight="bold" fill="#ffffff">
              {s.id}
            </text>
          </g>
        );
      })}
    </g>
  );
}

// ── CombinedTrackCanvas ──────────────────────────────────────────────────────

interface Props {
  loops: LoopState[];
}

export default function CombinedTrackCanvas({ loops }: Props) {
  // ── Geo loops: only those with valid authored geometry ──
  const geoLoops = useMemo(
    () => loops.filter((l) => {
      const geo = loopGeometry[l.id];
      return geo && validateLoopGeo(geo, l.checkpoints.length, l.id);
    }),
    [loops],
  );

  // ── Shared animation frame (~15 fps) ──
  const [tick, setTick] = useState(0);
  const rafRef = useRef<number | null>(null);
  const hasMoving = geoLoops.some((l) => l.shuttles.some((s) => s.status === 'moving'));

  useEffect(() => {
    if (!hasMoving) {
      if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
      return;
    }
    let last = 0;
    const frame = (ts: number) => {
      if (ts - last > 66) { last = ts; setTick((t) => t + 1); }
      rafRef.current = requestAnimationFrame(frame);
    };
    rafRef.current = requestAnimationFrame(frame);
    return () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current); };
  }, [hasMoving]);

  // ── Parent path map: collects offset path + L from each LoopLayer ──
  const pathMapRef = useRef<Map<number, { path: SVGPathElement; L: number }>>(new Map());
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0);

  const onPathMeasured = useCallback((loopId: number, path: SVGPathElement, L: number) => {
    pathMapRef.current.set(loopId, { path, L });
    forceUpdate();
  }, []);

  // ── Ribbon offsets (auto-centered unless loop specifies manual override) ──
  const count = geoLoops.length;
  const ribbonOffset = (loop: LoopState, idx: number): number => {
    const geo = loopGeometry[loop.id];
    if (geo.offset !== undefined) return geo.offset;
    return (idx - (count - 1) / 2) * RIBBON_GAP;
  };

  // ── Shared checkpoint groups (validated) ──
  const validGroups = useMemo(() => {
    const geoLoopIds = new Set(geoLoops.map((l) => l.id));
    const cpCounts   = new Map(geoLoops.map((l) => [l.id, l.checkpoints.length]));
    return validateSharedGroups(sharedCheckpointGroups, geoLoopIds, cpCounts);
  }, [geoLoops]);

  // Which checkpoint indices (per loop) are claimed by a shared group
  const groupedIndicesPerLoop = useMemo(() => {
    const map = new Map<number, Set<number>>();
    for (const group of validGroups) {
      for (const ref of group) {
        if (!map.has(ref.loopId)) map.set(ref.loopId, new Set());
        map.get(ref.loopId)!.add(ref.index);
      }
    }
    return map;
  }, [validGroups]);

  // ── Shared checkpoint merged markers ──
  // Computed after LoopLayers have measured their offset paths (pathMapRef is populated).
  const groupMarkers = useMemo(() => {
    return validGroups.map((group) => {
      const members = group.map((ref) => {
        const loop = geoLoops.find((l) => l.id === ref.loopId);
        const geo  = loopGeometry[ref.loopId];
        const pm   = pathMapRef.current.get(ref.loopId);
        if (!loop || !geo || !pm || pm.L === 0) return null;

        const t   = geo.checkpoints[ref.index].t;
        const pos = pointAtT(pm.path, t, pm.L);
        const cp  = loop.checkpoints[ref.index];
        const isCrash = loop.crashedSegments.some(
          (s) => s.fromIndex === ref.index || s.toIndex === ref.index,
        );
        const loopIdx = geoLoops.findIndex((l) => l.id === ref.loopId);
        const color   = geo.color ?? LOOP_DEFAULT_COLORS[loopIdx % LOOP_DEFAULT_COLORS.length];
        return { pos, cp, isCrash, color, label: String(ref.index + 1) };
      }).filter((m): m is NonNullable<typeof m> => m !== null);

      if (members.length < 2) return null;

      const cx       = members.reduce((s, m) => s + m.pos.x, 0) / members.length;
      const cy       = members.reduce((s, m) => s + m.pos.y, 0) / members.length;
      const detecting = members.some((m) => m.cp.detecting);
      const crashed   = members.some((m) => m.isCrash);
      const label     = members.map((m) => m.label).join('·');
      return { cx, cy, members, detecting, crashed, label };
    }).filter((g): g is NonNullable<typeof g> => g !== null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [validGroups, geoLoops, tick]); // tick keeps markers live during animation

  if (geoLoops.length === 0) return null;

  const { x: vx, y: vy, w: vw, h: vh } = TRACK_VIEWBOX;

  return (
    <div className="panel-card">
      {/* ── Shared SVG canvas ── */}
      <svg
        viewBox={`${vx} ${vy} ${vw} ${vh}`}
        className="w-full rounded-lg bg-slate-50 border border-slate-100"
        style={{ maxHeight: 480 }}
      >
        {/* Loop layers (track + checkpoints + shuttles on offset ribbons) */}
        {geoLoops.map((loop, idx) => {
          const geo   = loopGeometry[loop.id]!;
          const color = geo.color ?? LOOP_DEFAULT_COLORS[idx % LOOP_DEFAULT_COLORS.length];
          return (
            <LoopLayer
              key={loop.id}
              loop={loop}
              geo={geo}
              color={color}
              offsetAmount={ribbonOffset(loop, idx)}
              tick={tick}
              groupedCheckpointIndices={groupedIndicesPerLoop.get(loop.id) ?? new Set()}
              onPathMeasured={onPathMeasured}
            />
          );
        })}

        {/* Shared checkpoint merged markers (rendered on top of all loop layers) */}
        {groupMarkers.map((gm, gi) => {
          const n     = gm.members.length;
          const degPer = 360 / n;
          // Segments start at -90° (top of circle) and go clockwise
          return (
            <g key={`shared-${gi}`}>
              {gm.detecting && (
                <circle cx={gm.cx} cy={gm.cy} r={CP_R + 9}
                  fill="none" stroke={CP_DETECT} strokeWidth={2} opacity={0.4} />
              )}
              {/* White background disc */}
              <circle cx={gm.cx} cy={gm.cy} r={CP_R}
                fill={gm.crashed ? '#fef2f2' : CP_FILL} />
              {/* Split-color ring arcs, one per member loop */}
              {gm.members.map((m, mi) => {
                const startDeg = -90 + degPer * mi;
                const endDeg   = -90 + degPer * (mi + 1);
                const arcColor = gm.crashed ? CP_CRASH_COLOR : m.color;
                return (
                  <path
                    key={mi}
                    d={arcSegmentPath(gm.cx, gm.cy, CP_R, startDeg, endDeg)}
                    fill="none"
                    stroke={arcColor}
                    strokeWidth={3.5}
                    strokeLinecap="round"
                  />
                );
              })}
              {/* Combined label e.g. "1·2" */}
              <text x={gm.cx} y={gm.cy + 1}
                textAnchor="middle" dominantBaseline="middle"
                fontSize="7" fontWeight="bold"
                fill={gm.crashed ? TEXT_CRASH : '#475569'}>
                {gm.label}
              </text>
            </g>
          );
        })}
      </svg>

      {/* ── Per-loop control strip ── */}
      <div className="mt-3 space-y-2">
        {geoLoops.map((loop, idx) => {
          const geo   = loopGeometry[loop.id]!;
          const color = geo.color ?? LOOP_DEFAULT_COLORS[idx % LOOP_DEFAULT_COLORS.length];
          return (
            <div key={loop.id} className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2 min-w-[130px]">
                <span className="h-3 w-3 rounded-full shrink-0" style={{ background: color }} />
                <span className="text-xs font-semibold text-ink">{loop.name}</span>
              </div>
              <button
                onClick={() => socket.emit('stopLoop', { loopId: loop.id })}
                disabled={loop.shuttles.length === 0}
                className="rounded border border-red-300 bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-600 hover:bg-red-100 hover:border-red-400 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                Stop
              </button>
              <div className="flex flex-wrap gap-1.5">
                {loop.shuttles.map((s) => (
                  <span key={s.id} className={`rounded-full px-2 py-0.5 text-xs font-semibold border ${
                    s.status === 'crashed'  ? 'border-red-300 bg-red-50 text-red-700' :
                    s.status === 'stopped' ? 'border-amber-300 bg-amber-50 text-amber-700' :
                    'border-blue-300 bg-blue-50 text-blue-700'
                  }`}>
                    #{s.id} — {s.status.charAt(0).toUpperCase() + s.status.slice(1)}
                    {s.stoppedAtName ? ` @ ${s.stoppedAtName.split('—')[0].trim()}` : ''}
                  </span>
                ))}
                {loop.shuttles.length === 0 && (
                  <span className="text-xs text-ink-faint">No shuttles detected</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
