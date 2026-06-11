/**
 * LoopVisualizer — SVG diagram of a loop.
 * Renders checkpoints as numbered circles connected by track segments.
 * Moving/stopped shuttles are shown as colored markers.
 * Crashed segments turn red.
 *
 * Animation: uses requestAnimationFrame to interpolate moving shuttles
 * at ~15 fps so markers visibly travel along the arc between ticks.
 */
import { useEffect, useRef, useState } from 'react';
import type { LoopState, VirtualShuttleState } from '../../../server/src/types';
import { socket } from '../lib/socket';

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
