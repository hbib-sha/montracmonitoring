/**
 * LoopVisualizer — SVG diagram of a loop.
 * Renders checkpoints as numbered circles connected by track segments.
 * Moving/stopped shuttles are shown as colored markers.
 * Crashed segments turn red.
 *
 * Animation: uses requestAnimationFrame to interpolate moving shuttles
 * at ~15 fps so markers visibly travel along the arc between ticks.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { LoopState, VirtualShuttleState } from '../../../server/src/types';
import { socket } from '../lib/socket';
import {
  loopGeometry,
  validateLoopGeo,
  TRACK_VIEWBOX,
  type LoopGeometry,
} from '../loopGeometry';
import {
  pointAtT,
  tangentAtT,
  shuttleTValue,
  crashPolylinePoints,
} from '../lib/trackGeometry';

interface Props {
  loop: LoopState;
}

// ── Layout constants ────────────────────────────────────────────────────────
const W = 520;
const H = 270;
const CX = W / 2;
const CY = H / 2;
const RX = 190;
const RY = 95;
const CP_R = 20;

// ── Light-theme color palette (matched to Tailwind config) ──────────────────
const TRACK_NORMAL = '#cbd5e1';  // slate-300
const TRACK_CRASH  = '#dc2626';  // red-600
const CP_FILL      = '#ffffff';
const CP_STROKE    = '#cbd5e1';  // slate-300
const CP_DETECT    = '#16a34a';  // green-600
const CP_CRASH     = '#dc2626';  // red-600
const TEXT_NORMAL  = '#64748b';  // slate-500
const TEXT_DETECT  = '#16a34a';
const TEXT_CRASH   = '#dc2626';
const SHUTTLE_MOVE = '#2563eb';  // blue-600
const SHUTTLE_STOP = '#d97706';  // amber-600
const SHUTTLE_DEAD = '#dc2626';  // red-600

function cpPosition(index: number, total: number): { x: number; y: number } {
  const angle = -Math.PI / 2 + (2 * Math.PI * index) / total;
  return { x: CX + RX * Math.cos(angle), y: CY + RY * Math.sin(angle) };
}

function shuttlePosition(
  fromIdx: number,
  toIdx: number,
  total: number,
  progress: number,
): { x: number; y: number } {
  const fromAngle = -Math.PI / 2 + (2 * Math.PI * fromIdx) / total;
  const toAngle   = -Math.PI / 2 + (2 * Math.PI * toIdx)   / total;
  let dAngle = toAngle - fromAngle;
  if (dAngle < 0) dAngle += 2 * Math.PI;
  const angle = fromAngle + dAngle * progress;
  return { x: CX + RX * Math.cos(angle), y: CY + RY * Math.sin(angle) };
}

// ── Geometry-mode constants (authored-shape rendering) ──────────────────────
const GEO_CP_R       = 16;  // checkpoint circle radius in TRACK_VIEWBOX units
const GEO_PARK_OFFSET = 26; // perpendicular offset for stopped/crashed shuttles
const GEO_PAD        = 42;  // viewBox padding around the path bounding box

/**
 * GeometryTrack — renders the loop along its authored SVG path (loopGeometry).
 * Drop-in replacement for the ellipse <svg> when geometry exists for this loop.
 * Reuses the same monitoring palette (neutral track, green/red checkpoints,
 * blue/amber/red shuttles) as the ellipse view — only the shape changes.
 */
function GeometryTrack({
  loop,
  geo,
  tick,
}: {
  loop: LoopState;
  geo: LoopGeometry;
  tick: number;
}) {
  const { checkpoints, shuttles, crashedSegments } = loop;
  const n = checkpoints.length;
  const cpTs = geo.checkpoints.map((c) => c.t);

  const pathRef = useRef<SVGPathElement | null>(null);
  const [L, setL] = useState(0);
  const [viewBox, setViewBox] = useState(
    `${TRACK_VIEWBOX.x} ${TRACK_VIEWBOX.y} ${TRACK_VIEWBOX.w} ${TRACK_VIEWBOX.h}`,
  );

  // After the path mounts, measure its length and fit the viewBox to its bbox.
  useLayoutEffect(() => {
    const path = pathRef.current;
    if (!path) return;
    setL(path.getTotalLength());
    const bb = path.getBBox();
    setViewBox(
      `${bb.x - GEO_PAD} ${bb.y - GEO_PAD} ${bb.width + GEO_PAD * 2} ${bb.height + GEO_PAD * 2}`,
    );
  }, [geo.d]);

  void tick; // prop bump forces re-render at animation rate

  const point = (t: number) =>
    pathRef.current && L > 0 ? pointAtT(pathRef.current, t, L) : { x: 0, y: 0 };

  const normalAt = (t: number) => {
    if (!pathRef.current || L === 0) return { x: 0, y: 1 };
    const tg = tangentAtT(pathRef.current, t, L);
    return { x: -tg.y, y: tg.x }; // 90° CW
  };

  const shuttlePos = (s: VirtualShuttleState) => {
    const fromT = cpTs[s.checkpointIndex];
    const toT   = cpTs[(s.checkpointIndex + 1) % n];
    if (s.status === 'moving' && s.movedAtMs && s.etaMs) {
      const progress = Math.min(1, (Date.now() - s.movedAtMs) / s.etaMs);
      return point(shuttleTValue(fromT, toT, progress));
    }
    const base = point(fromT);
    const nor  = normalAt(fromT);
    return { x: base.x + nor.x * GEO_PARK_OFFSET, y: base.y + nor.y * GEO_PARK_OFFSET };
  };

  return (
    <svg viewBox={viewBox} className="w-full" style={{ maxHeight: 260 }}>
      {/* Track path */}
      <path
        ref={pathRef}
        d={geo.d}
        fill="none"
        stroke={TRACK_NORMAL}
        strokeWidth={4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Crash segment overlays */}
      {L > 0 && pathRef.current && crashedSegments.map((seg) => {
        const pts = crashPolylinePoints(
          pathRef.current!, L, cpTs[seg.fromIndex], cpTs[seg.toIndex],
        );
        return (
          <g key={`crash-${seg.fromIndex}-${seg.toIndex}`}>
            <polyline points={pts} fill="none" stroke={TRACK_CRASH}
              strokeWidth={6} strokeLinecap="round" />
            <polyline points={pts} fill="none" stroke={TRACK_CRASH}
              strokeWidth={12} strokeLinecap="round" opacity={0.25} />
          </g>
        );
      })}

      {/* Checkpoint circles */}
      {L > 0 && checkpoints.map((cp, i) => {
        const { x, y }    = point(cpTs[i]);
        const isCrashFrom = crashedSegments.some((s) => s.fromIndex === i);
        const isCrashTo   = crashedSegments.some((s) => s.toIndex   === i);
        const highlight   = isCrashFrom || isCrashTo;
        const strokeColor = highlight ? CP_CRASH : cp.detecting ? CP_DETECT : CP_STROKE;
        const textColor   = highlight ? TEXT_CRASH : cp.detecting ? TEXT_DETECT : TEXT_NORMAL;
        return (
          <g key={cp.id}>
            {cp.detecting && (
              <circle cx={x} cy={y} r={GEO_CP_R + 7} fill="none"
                stroke={CP_DETECT} strokeWidth={2} opacity={0.35} />
            )}
            <circle cx={x} cy={y} r={GEO_CP_R}
              fill={highlight ? '#fef2f2' : CP_FILL} stroke={strokeColor} strokeWidth={2} />
            <text x={x} y={y - 2} textAnchor="middle" dominantBaseline="middle"
              fontSize="10" fontWeight="bold" fill={textColor}>
              {i + 1}
            </text>
            <text x={x} y={y + 8} textAnchor="middle" dominantBaseline="middle"
              fontSize="5.5" fill={highlight ? TEXT_CRASH : '#94a3b8'}>
              {cp.type}
            </text>
            <text x={x} y={y + GEO_CP_R + 11} textAnchor="middle"
              fontSize="7" fill={highlight ? TEXT_CRASH : TEXT_NORMAL}>
              {cp.name.split('—')[0].trim()}
            </text>
          </g>
        );
      })}

      {/* Virtual shuttles */}
      {L > 0 && shuttles.map((s) => {
        const pos = shuttlePos(s);
        const color =
          s.status === 'crashed' ? SHUTTLE_DEAD
          : s.status === 'stopped' ? SHUTTLE_STOP
          : SHUTTLE_MOVE;
        return (
          <g key={s.id}>
            <circle cx={pos.x} cy={pos.y} r={9} fill={color} opacity={0.9} />
            <text x={pos.x} y={pos.y + 1} textAnchor="middle" dominantBaseline="middle"
              fontSize="7" fontWeight="bold" fill="#ffffff">
              {s.id}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function ShuttleMarker({
  shuttle,
  total,
  tick,
}: {
  shuttle: VirtualShuttleState;
  total: number;
  tick: number; // changes each animation frame when moving
}) {
  const fromIdx = shuttle.checkpointIndex;
  const toIdx   = (fromIdx + 1) % total;

  let pos: { x: number; y: number };

  if (shuttle.status === 'moving' && shuttle.movedAtMs && shuttle.etaMs) {
    const progress = Math.min(1, (Date.now() - shuttle.movedAtMs) / shuttle.etaMs);
    pos = shuttlePosition(fromIdx, toIdx, total, progress);
  } else {
    // Stopped/crashed — place just outside the checkpoint circle
    const angle = -Math.PI / 2 + (2 * Math.PI * fromIdx) / total;
    const base  = cpPosition(fromIdx, total);
    pos = { x: base.x + Math.cos(angle) * 30, y: base.y + Math.sin(angle) * 30 };
  }

  const color =
    shuttle.status === 'crashed' ? SHUTTLE_DEAD
    : shuttle.status === 'stopped' ? SHUTTLE_STOP
    : SHUTTLE_MOVE;

  // Prevent "unused variable" warning — tick is used to force re-render
  void tick;

  return (
    <g>
      <circle cx={pos.x} cy={pos.y} r={9} fill={color} opacity={0.9} />
      <text
        x={pos.x} y={pos.y + 1}
        textAnchor="middle" dominantBaseline="middle"
        fontSize="7" fontWeight="bold" fill="#ffffff"
      >
        {shuttle.id}
      </text>
    </g>
  );
}

export default function LoopVisualizer({ loop }: Props) {
  const { checkpoints, shuttles, crashedSegments } = loop;
  const n = checkpoints.length;

  const handleStop = () => {
    socket.emit('stopLoop', { loopId: loop.id });
  };

  // Animation frame: bump `tick` at ~15fps while any shuttle is moving
  const [tick, setTick] = useState(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const hasMoving = shuttles.some((s) => s.status === 'moving');
    if (!hasMoving) {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      return;
    }

    let last = 0;
    const frame = (ts: number) => {
      if (ts - last > 66) { // ~15 fps
        last = ts;
        setTick((t) => t + 1);
      }
      rafRef.current = requestAnimationFrame(frame);
    };
    rafRef.current = requestAnimationFrame(frame);

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [shuttles]);

  if (n === 0) return null;

  // If this loop has authored geometry, render along its real shape.
  const geo    = loopGeometry[loop.id];
  const useGeo = !!geo && validateLoopGeo(geo, n, loop.id);

  const positions = checkpoints.map((_, i) => cpPosition(i, n));

  const segmentPath = (fromIdx: number, toIdx: number): string => {
    const from = positions[fromIdx];
    const to   = positions[toIdx];
    return `M ${from.x} ${from.y} A ${RX} ${RY} 0 0 1 ${to.x} ${to.y}`;
  };

  return (
    <div className="panel-card">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-semibold text-ink">{loop.name}</h3>
          <button
            onClick={handleStop}
            disabled={shuttles.length === 0}
            className="rounded border border-red-300 bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-600 hover:bg-red-100 hover:border-red-400 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Stop
          </button>
        </div>
        <div className="flex items-center gap-4 text-xs text-ink-faint">
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: SHUTTLE_MOVE }} />
            Moving
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: SHUTTLE_STOP }} />
            Stopped
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: SHUTTLE_DEAD }} />
            Crashed
          </span>
        </div>
      </div>

      {useGeo && geo ? (
        <GeometryTrack loop={loop} geo={geo} tick={tick} />
      ) : (
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 230 }}>
        {/* Track segments */}
        {checkpoints.map((_, i) => {
          const nextIdx  = (i + 1) % n;
          const isCrash  = crashedSegments.some((s) => s.fromIndex === i && s.toIndex === nextIdx);
          return (
            <path
              key={`seg-${i}`}
              d={segmentPath(i, nextIdx)}
              fill="none"
              stroke={isCrash ? TRACK_CRASH : TRACK_NORMAL}
              strokeWidth={isCrash ? 5 : 3}
              strokeLinecap="round"
            />
          );
        })}

        {/* Crash flash overlay */}
        {crashedSegments.map((seg) => (
          <path
            key={`crash-${seg.fromIndex}-${seg.toIndex}`}
            d={segmentPath(seg.fromIndex, seg.toIndex)}
            fill="none"
            stroke={TRACK_CRASH}
            strokeWidth={7}
            strokeLinecap="round"
            opacity={0.25}
          />
        ))}

        {/* Checkpoint circles */}
        {checkpoints.map((cp, i) => {
          const { x, y }   = positions[i];
          const isCrashFrom = crashedSegments.some((s) => s.fromIndex === i);
          const isCrashTo   = crashedSegments.some((s) => s.toIndex   === i);
          const highlight   = isCrashFrom || isCrashTo;
          const strokeColor = highlight ? CP_CRASH : cp.detecting ? CP_DETECT : CP_STROKE;
          const textColor   = highlight ? TEXT_CRASH : cp.detecting ? TEXT_DETECT : TEXT_NORMAL;

          return (
            <g key={cp.id}>
              {/* Glow ring for detecting */}
              {cp.detecting && (
                <circle
                  cx={x} cy={y} r={CP_R + 7}
                  fill="none"
                  stroke={CP_DETECT}
                  strokeWidth={2}
                  opacity={0.35}
                />
              )}
              <circle
                cx={x} cy={y} r={CP_R}
                fill={highlight ? '#fef2f2' : CP_FILL}
                stroke={strokeColor}
                strokeWidth={2}
              />
              {/* Checkpoint number */}
              <text
                x={x} y={y - 3}
                textAnchor="middle" dominantBaseline="middle"
                fontSize="11" fontWeight="bold" fill={textColor}
              >
                {i + 1}
              </text>
              {/* Type badge */}
              <text
                x={x} y={y + 10}
                textAnchor="middle" dominantBaseline="middle"
                fontSize="6" fill={highlight ? TEXT_CRASH : '#94a3b8'}
              >
                {cp.type}
              </text>
              {/* Label below circle */}
              <text
                x={x} y={y + CP_R + 13}
                textAnchor="middle"
                fontSize="8" fill={highlight ? TEXT_CRASH : TEXT_NORMAL}
              >
                {cp.name.split('—')[0].trim()}
              </text>
            </g>
          );
        })}

        {/* Virtual shuttles */}
        {shuttles.map((s) => (
          <ShuttleMarker key={s.id} shuttle={s} total={n} tick={tick} />
        ))}
      </svg>
      )}

      {/* Shuttle legend */}
      {shuttles.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {shuttles.map((s) => (
            <span
              key={s.id}
              className={`rounded-full px-2.5 py-0.5 text-xs font-semibold border ${
                s.status === 'crashed'
                  ? 'border-red-300 bg-red-50 text-red-700'
                  : s.status === 'stopped'
                  ? 'border-amber-300 bg-amber-50 text-amber-700'
                  : 'border-blue-300 bg-blue-50 text-blue-700'
              }`}
            >
              Shuttle #{s.id} — {s.status.charAt(0).toUpperCase() + s.status.slice(1)}
              {s.stoppedAtName ? ` @ ${s.stoppedAtName.split('—')[0].trim()}` : ''}
            </span>
          ))}
        </div>
      )}

      {shuttles.length === 0 && (
        <p className="text-xs text-ink-faint text-center mt-2">No shuttles detected</p>
      )}
    </div>
  );
}
