/**
 * GeometryEditor.tsx — /geometry
 *
 * Dev/authoring tool for drawing real-shape loop geometry and linking shared checkpoints.
 *
 * Workflow:
 *   1. Select a loop from the dropdown.
 *   2. "Draw path" mode: click to place anchor points along the real track shape.
 *      Bends/curves need NOT coincide with checkpoints.
 *      Click near the first anchor ● to close, or press "Close loop".
 *      Drag anchors to fine-tune positions.
 *   3. "Checkpoints" mode: click near the path to snap each checkpoint in order.
 *   4. Repeat for other loops (they layer for alignment).
 *   5. "Link" mode: click a checkpoint from one loop then a checkpoint from another
 *      loop to mark them as the same physical sensor. Linked checkpoints render as
 *      a single split-color ring in the Overall Circuit view.
 *   6. "Copy export" → paste per-loop block into loopGeometry.ts.
 *      "Copy links" → paste sharedCheckpointGroups into loopGeometry.ts.
 *
 * Nothing writes to disk — all exports are copy-paste.
 */
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveState } from '../store/useLiveState';
import {
  TRACK_VIEWBOX,
  loopGeometry,
  validateLoopGeo,
  sharedCheckpointGroups,
  LOOP_DEFAULT_COLORS,
  type SharedCheckpointRef,
} from '../loopGeometry';
import { findNearestT } from '../lib/trackGeometry';

// ── Types ────────────────────────────────────────────────────────────────────

type Point = { x: number; y: number };
type Mode  = 'draw' | 'checkpoints' | 'link';

// ── Catmull-Rom → cubic Bezier SVG path ─────────────────────────────────────

function catmullRomPath(pts: Point[], closed: boolean): string {
  const n = pts.length;
  if (n === 0) return '';
  if (n === 1) return `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;

  const p = (i: number): Point =>
    closed
      ? pts[((i % n) + n) % n]
      : pts[Math.min(Math.max(i, 0), n - 1)];

  let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  const segments = closed ? n : n - 1;

  for (let i = 0; i < segments; i++) {
    const p0 = p(i - 1), p1 = p(i), p2 = p(i + 1), p3 = p(i + 2);
    const cp1x = (p1.x + (p2.x - p0.x) / 6).toFixed(1);
    const cp1y = (p1.y + (p2.y - p0.y) / 6).toFixed(1);
    const cp2x = (p2.x - (p3.x - p1.x) / 6).toFixed(1);
    const cp2y = (p2.y - (p3.y - p1.y) / 6).toFixed(1);
    d += ` C ${cp1x} ${cp1y} ${cp2x} ${cp2y} ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  if (closed) d += ' Z';
  return d;
}

// ── SVG coordinate helper ────────────────────────────────────────────────────

function toSvgPoint(e: React.MouseEvent, svgEl: SVGSVGElement): Point {
  const pt = svgEl.createSVGPoint();
  pt.x = e.clientX;
  pt.y = e.clientY;
  const m = svgEl.getScreenCTM();
  if (!m) return { x: 0, y: 0 };
  const sp = pt.matrixTransform(m.inverse());
  return { x: sp.x, y: sp.y };
}

// ── Group key helper ─────────────────────────────────────────────────────────

function refKey(r: SharedCheckpointRef) { return `${r.loopId}:${r.index}`; }

// ── Constants ─────────────────────────────────────────────────────────────────

const VB              = TRACK_VIEWBOX;
const CLOSE_THRESHOLD = 22;
const ANCHOR_R        = 7;
const CP_MARKER_R     = 9;
const DRAG_THRESHOLD  = 4;

// ── GeometryEditor page ──────────────────────────────────────────────────────

export default function GeometryEditorPage() {
  const navigate   = useNavigate();
  const { system } = useLiveState();
  const loops      = system?.loops ?? [];

  // ── Per-loop authoring state ─────────────────────────────────────────────
  const [selectedLoopId, setSelectedLoopId] = useState<number | null>(null);
  const [anchors,        setAnchors]         = useState<Point[]>([]);
  const [closed,         setClosed]          = useState(false);
  const [checkpointTs,   setCheckpointTs]    = useState<number[]>([]);
  const [mode,           setMode]            = useState<Mode>('draw');
  const [color,          setColor]           = useState(LOOP_DEFAULT_COLORS[0]);
  const [ribbonOffset,   setRibbonOffset]    = useState<number | undefined>(undefined);

  // ── Cross-loop link state ────────────────────────────────────────────────
  const [links,       setLinks]       = useState<SharedCheckpointRef[][]>(
    () => sharedCheckpointGroups.map((g) => [...g]),
  );
  const [pendingLink, setPendingLink] = useState<SharedCheckpointRef | null>(null);

  // ── Interaction state ────────────────────────────────────────────────────
  const [mousePos,    setMousePos]    = useState<Point | null>(null);
  const [previewSnap, setPreviewSnap] = useState<Point | null>(null);
  const [copiedLoop,  setCopiedLoop]  = useState(false);
  const [copiedLinks, setCopiedLinks] = useState(false);

  // ── Refs ─────────────────────────────────────────────────────────────────
  const svgRef       = useRef<SVGSVGElement | null>(null);
  const drawnPathRef = useRef<SVGPathElement | null>(null);
  // Refs for existing geo loop paths (for position lookup in link mode)
  const geoPathRefs  = useRef<Map<number, SVGPathElement>>(new Map());
  const draggingIdx  = useRef<number | null>(null);
  const dragStart    = useRef<Point | null>(null);
  const dragDist     = useRef(0);

  // Path length for the current session loop
  const [pathL, setPathL] = useState(0);
  useLayoutEffect(() => {
    if (drawnPathRef.current && closed && anchors.length >= 3) {
      setPathL(drawnPathRef.current.getTotalLength());
    } else {
      setPathL(0);
    }
  }, [anchors, closed]);

  // Derived values
  const selectedLoop    = loops.find((l) => l.id === selectedLoopId) ?? null;
  const requiredCpCount = selectedLoop?.checkpoints.length ?? 0;
  const currentPath     = useMemo(
    () => (anchors.length >= 2 ? catmullRomPath(anchors, closed) : ''),
    [anchors, closed],
  );
  const cpComplete  = checkpointTs.length === requiredCpCount && requiredCpCount > 0;
  const canExport   = closed && anchors.length >= 3 && cpComplete;

  // ── Loop selection ────────────────────────────────────────────────────────

  function selectLoop(id: number) {
    setSelectedLoopId(id);
    setAnchors([]);
    setClosed(false);
    setCheckpointTs([]);
    setMode('draw');
    setPreviewSnap(null);
    setPendingLink(null);
    setCopiedLoop(false);
    const loopIdx    = loops.findIndex((l) => l.id === id);
    const existingGeo = loopGeometry[id];
    setColor(existingGeo?.color ?? LOOP_DEFAULT_COLORS[loopIdx % LOOP_DEFAULT_COLORS.length]);
    setRibbonOffset(existingGeo?.offset);
  }

  // ── SVG interaction ───────────────────────────────────────────────────────

  function handleAnchorMouseDown(e: React.MouseEvent, idx: number) {
    e.stopPropagation();
    draggingIdx.current = idx;
    dragDist.current    = 0;
    dragStart.current   = svgRef.current ? toSvgPoint(e, svgRef.current) : null;
  }

  function handleSvgMouseMove(e: React.MouseEvent<SVGSVGElement>) {
    if (!svgRef.current) return;
    const pt = toSvgPoint(e, svgRef.current);
    setMousePos(pt);

    if (draggingIdx.current !== null) {
      if (dragStart.current) {
        const dx = pt.x - dragStart.current.x;
        const dy = pt.y - dragStart.current.y;
        dragDist.current = Math.sqrt(dx * dx + dy * dy);
      }
      const idx = draggingIdx.current;
      setAnchors((prev) => prev.map((a, i) => (i === idx ? pt : a)));
      return;
    }

    if (mode === 'checkpoints' && drawnPathRef.current && pathL > 0) {
      const t   = findNearestT(drawnPathRef.current, pathL, pt.x, pt.y, 200);
      const raw = drawnPathRef.current.getPointAtLength(t * pathL);
      setPreviewSnap({ x: raw.x, y: raw.y });
    } else {
      setPreviewSnap(null);
    }
  }

  function handleSvgMouseUp() { draggingIdx.current = null; }

  function handleSvgClick(e: React.MouseEvent<SVGSVGElement>) {
    if (!svgRef.current || !selectedLoop) return;
    if (dragDist.current > DRAG_THRESHOLD) { dragDist.current = 0; return; }
    dragDist.current = 0;

    const pt = toSvgPoint(e, svgRef.current);

    if (mode === 'draw') {
      if (closed) return;
      if (anchors.length >= 3) {
        const dx = pt.x - anchors[0].x;
        const dy = pt.y - anchors[0].y;
        if (Math.sqrt(dx * dx + dy * dy) < CLOSE_THRESHOLD) {
          setClosed(true);
          setMode('checkpoints');
          return;
        }
      }
      setAnchors((prev) => [...prev, pt]);

    } else if (mode === 'checkpoints') {
      if (!drawnPathRef.current || pathL === 0) return;
      if (checkpointTs.length >= requiredCpCount) return;
      const t = findNearestT(drawnPathRef.current, pathL, pt.x, pt.y, 600);
      setCheckpointTs((prev) => [...prev, t]);
    }
    // link mode clicks are handled by checkpoint-circle onClick handlers
  }

  // ── Link mode: click a CP in one loop then another to link them ──────────

  function handleLinkClick(loopId: number, cpIdx: number) {
    const ref: SharedCheckpointRef = { loopId, index: cpIdx };
    const key = refKey(ref);

    if (!pendingLink) {
      setPendingLink(ref);
      return;
    }
    const pendingKey = refKey(pendingLink);

    // Cancel if clicking the same checkpoint
    if (pendingKey === key) { setPendingLink(null); return; }

    const pendingGrpIdx = links.findIndex((g) => g.some((r) => refKey(r) === pendingKey));
    const thisGrpIdx    = links.findIndex((g) => g.some((r) => refKey(r) === key));

    // Already in same group → they're linked, no change; just clear pending
    if (pendingGrpIdx !== -1 && thisGrpIdx !== -1 && pendingGrpIdx === thisGrpIdx) {
      setPendingLink(null);
      return;
    }

    setLinks((prev) => {
      let next = [...prev];
      if (pendingGrpIdx !== -1 && thisGrpIdx !== -1) {
        // Different groups → merge
        const merged = [...next[pendingGrpIdx], ...next[thisGrpIdx]];
        next = next.filter((_, i) => i !== pendingGrpIdx && i !== thisGrpIdx);
        next.push(merged);
      } else if (pendingGrpIdx !== -1) {
        next = next.map((g, i) => i === pendingGrpIdx ? [...g, ref] : g);
      } else if (thisGrpIdx !== -1) {
        next = next.map((g, i) => i === thisGrpIdx ? [...g, pendingLink] : g);
      } else {
        next.push([pendingLink, ref]);
      }
      return next;
    });
    setPendingLink(null);
  }

  function handleUnlink(loopId: number, cpIdx: number) {
    const key = `${loopId}:${cpIdx}`;
    setLinks((prev) =>
      prev
        .map((g) => g.filter((r) => refKey(r) !== key))
        .filter((g) => g.length >= 2),
    );
    setPendingLink(null);
  }

  // ── Helpers for link mode checkpoint position lookup ─────────────────────

  function getGeoLoopCpPos(loopId: number, cpIdx: number): Point | null {
    const geo = loopGeometry[loopId];
    if (!geo) return null;
    const el = geoPathRefs.current.get(loopId);
    if (!el) return null;
    const L = el.getTotalLength();
    if (L === 0) return null;
    const t  = geo.checkpoints[cpIdx]?.t;
    if (t === undefined) return null;
    const pt = el.getPointAtLength(Math.min(Math.max(t, 0), 0.9999) * L);
    return { x: pt.x, y: pt.y };
  }

  function getCurrentSessionCpPos(cpIdx: number): Point | null {
    if (!drawnPathRef.current || pathL === 0) return null;
    const t = checkpointTs[cpIdx];
    if (t === undefined) return null;
    const pt = drawnPathRef.current.getPointAtLength(Math.min(Math.max(t, 0), 0.9999) * pathL);
    return { x: pt.x, y: pt.y };
  }

  // All checkpoints visible in link mode: geo loops + current session loop
  interface LinkCpInfo { loopId: number; cpIdx: number; pos: Point; color: string; }

  const linkTargets = useMemo((): LinkCpInfo[] => {
    if (mode !== 'link') return [];
    const targets: LinkCpInfo[] = [];
    const loopCount = loops.length;

    // From existing geo loops
    for (const [idStr, geo] of Object.entries(loopGeometry)) {
      const loopId  = Number(idStr);
      const loop    = loops.find((l) => l.id === loopId);
      if (!loop || !validateLoopGeo(geo, loop.checkpoints.length, loopId)) continue;
      const loopIdx = loops.findIndex((l) => l.id === loopId);
      const c       = geo.color ?? LOOP_DEFAULT_COLORS[loopIdx % LOOP_DEFAULT_COLORS.length];
      for (let i = 0; i < geo.checkpoints.length; i++) {
        const pos = getGeoLoopCpPos(loopId, i);
        if (pos) targets.push({ loopId, cpIdx: i, pos, color: c });
      }
    }

    // From current session loop (if closed with checkpoints, and not already in loopGeometry)
    if (selectedLoopId !== null && !loopGeometry[selectedLoopId] && closed && pathL > 0) {
      const loopIdx = loops.findIndex((l) => l.id === selectedLoopId);
      const c       = color ?? LOOP_DEFAULT_COLORS[loopIdx % LOOP_DEFAULT_COLORS.length];
      for (let i = 0; i < checkpointTs.length; i++) {
        const pos = getCurrentSessionCpPos(i);
        if (pos) targets.push({ loopId: selectedLoopId, cpIdx: i, pos, color: c });
      }
    }

    void loopCount; // ensures recalc when loops change
    return targets;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, loops, loopGeometry, selectedLoopId, closed, pathL, checkpointTs, color]);

  // ── Exports ───────────────────────────────────────────────────────────────

  const loopExportBlock = useMemo(() => {
    if (!selectedLoop || !canExport) return '';
    const cpLines    = checkpointTs.map((t) => `    { t: ${t.toFixed(4)} }`).join(',\n');
    const offsetLine = ribbonOffset !== undefined ? `  offset: ${ribbonOffset},\n` : '';
    return [
      `// Paste into client/src/loopGeometry.ts`,
      `loopGeometry[${selectedLoop.id}] = {`,
      `  d: ${JSON.stringify(currentPath)},`,
      `  color: "${color}",`,
      `${offsetLine}  checkpoints: [`,
      cpLines,
      `  ],`,
      `};`,
    ].join('\n');
  }, [selectedLoop, canExport, currentPath, color, checkpointTs, ribbonOffset]);

  const linksExportBlock = useMemo(() => {
    if (links.length === 0) {
      return `// Replace sharedCheckpointGroups in client/src/loopGeometry.ts\nexport const sharedCheckpointGroups: SharedCheckpointRef[][] = [];`;
    }
    const rows = links
      .map((g) => `  [${g.map((r) => `{ loopId: ${r.loopId}, index: ${r.index} }`).join(', ')}],`)
      .join('\n');
    return [
      `// Replace sharedCheckpointGroups in client/src/loopGeometry.ts`,
      `export const sharedCheckpointGroups: SharedCheckpointRef[][] = [`,
      rows,
      `];`,
    ].join('\n');
  }, [links]);

  async function handleCopyLoop() {
    if (!loopExportBlock) return;
    await navigator.clipboard.writeText(loopExportBlock);
    setCopiedLoop(true);
    setTimeout(() => setCopiedLoop(false), 2500);
  }

  async function handleCopyLinks() {
    await navigator.clipboard.writeText(linksExportBlock);
    setCopiedLinks(true);
    setTimeout(() => setCopiedLinks(false), 2500);
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const cpProgress = `${checkpointTs.length} / ${requiredCpCount}`;
  const pendingKey = pendingLink ? refKey(pendingLink) : null;
  const linkedKeys = new Set(links.flatMap((g) => g.map(refKey)));

  return (
    <div className="flex flex-col h-full min-h-screen bg-surface">
      {/* ── Nav ── */}
      <nav className="border-b border-line bg-white px-4 py-2.5 flex items-center gap-3 shrink-0 shadow-sm">
        <button onClick={() => navigate('/')} className="text-xs text-slate-500 hover:text-slate-900 transition-colors">
          ← Dashboard
        </button>
        <span className="h-4 w-px bg-slate-200" />
        <span className="text-sm font-semibold tracking-tight text-ink">Circuit Geometry Editor</span>
        <span className="text-xs bg-amber-50 border border-amber-200 text-amber-700 px-2 py-0.5 rounded-full">dev tool</span>
      </nav>

      <main className="flex-1 overflow-auto p-4 space-y-4">

        {/* ── Toolbar ── */}
        <div className="flex flex-wrap items-center gap-3">

          {/* Loop selector */}
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-ink-faint uppercase tracking-wider whitespace-nowrap">Loop</label>
            <select
              value={selectedLoopId ?? ''}
              onChange={(e) => { const id = Number(e.target.value); if (id) selectLoop(id); }}
              className="rounded border border-slate-200 px-2 py-1 text-sm text-ink bg-white"
            >
              <option value="">Select a loop…</option>
              {loops.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name} ({l.checkpoints.length} cp){loopGeometry[l.id] ? ' ✓' : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Mode toggle */}
          {selectedLoop && (
            <div className="flex rounded border border-slate-200 overflow-hidden text-xs font-medium">
              <button onClick={() => setMode('draw')}
                className={`px-3 py-1.5 transition-colors ${mode === 'draw' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
                Draw path
              </button>
              <button onClick={() => setMode('checkpoints')} disabled={!closed}
                className={`px-3 py-1.5 transition-colors disabled:opacity-40 ${mode === 'checkpoints' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
                Checkpoints ({cpProgress})
              </button>
              <button onClick={() => { setMode('link'); setPendingLink(null); }}
                className={`px-3 py-1.5 transition-colors ${mode === 'link' ? 'bg-violet-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
                Link ({links.length})
              </button>
            </div>
          )}

          {/* Color + ribbon offset */}
          {selectedLoop && (
            <>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <span className="text-xs font-medium text-ink-faint">Color</span>
                <input type="color" value={color} onChange={(e) => setColor(e.target.value)}
                  className="h-7 w-10 rounded cursor-pointer border border-slate-200" />
              </label>
              <label className="flex items-center gap-1.5">
                <span className="text-xs font-medium text-ink-faint whitespace-nowrap">Ribbon offset</span>
                <input
                  type="number" placeholder="auto"
                  value={ribbonOffset ?? ''}
                  onChange={(e) => setRibbonOffset(e.target.value !== '' ? Number(e.target.value) : undefined)}
                  className="w-16 rounded border border-slate-200 px-2 py-1 text-xs text-ink"
                />
              </label>
            </>
          )}

          {/* Draw mode actions */}
          {selectedLoop && mode === 'draw' && !closed && (
            <>
              <button disabled={anchors.length === 0}
                onClick={() => setAnchors((p) => p.slice(0, -1))}
                className="rounded border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-30 transition-colors">
                Undo
              </button>
              <button disabled={anchors.length < 3}
                onClick={() => { setClosed(true); setMode('checkpoints'); }}
                className="rounded border border-green-300 bg-green-50 px-3 py-1.5 text-xs font-semibold text-green-700 hover:bg-green-100 disabled:opacity-30 transition-colors">
                Close loop
              </button>
            </>
          )}
          {selectedLoop && mode === 'draw' && closed && (
            <button onClick={() => { setClosed(false); setCheckpointTs([]); }}
              className="rounded border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-100 transition-colors">
              Reopen path
            </button>
          )}

          {/* Checkpoint mode actions */}
          {selectedLoop && mode === 'checkpoints' && (
            <button disabled={checkpointTs.length === 0}
              onClick={() => setCheckpointTs((p) => p.slice(0, -1))}
              className="rounded border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-30 transition-colors">
              Remove last CP
            </button>
          )}

          {/* Link mode: unlink selected, clear pending */}
          {mode === 'link' && pendingLink && (
            <>
              <span className="text-xs text-ink-faint">
                Selected: Loop {pendingLink.loopId} CP{pendingLink.index + 1} — click another checkpoint to link
              </span>
              <button onClick={() => setPendingLink(null)}
                className="rounded border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50 transition-colors">
                Cancel
              </button>
              {linkedKeys.has(refKey(pendingLink)) && (
                <button onClick={() => handleUnlink(pendingLink.loopId, pendingLink.index)}
                  className="rounded border border-red-200 px-3 py-1.5 text-xs text-red-600 hover:bg-red-50 transition-colors">
                  Unlink
                </button>
              )}
            </>
          )}

          {/* Reset */}
          {selectedLoop && (
            <button
              onClick={() => { setAnchors([]); setClosed(false); setCheckpointTs([]); setMode('draw'); setPreviewSnap(null); setPendingLink(null); }}
              className="ml-auto rounded border border-red-200 px-3 py-1.5 text-xs text-red-600 hover:bg-red-50 transition-colors">
              Reset
            </button>
          )}
        </div>

        {/* ── Hint text ── */}
        <p className="text-xs text-ink-faint min-h-[16px]">
          {!selectedLoop && 'Select a loop to begin authoring its circuit shape.'}
          {selectedLoop && mode === 'draw' && !closed && anchors.length < 3 &&
            'Click anywhere to place anchor points. Bends can go anywhere — not only at checkpoints.'}
          {selectedLoop && mode === 'draw' && !closed && anchors.length >= 3 &&
            'Continue adding points, or click near the first anchor ● to close the loop.'}
          {selectedLoop && mode === 'draw' && closed &&
            'Loop closed. Switch to Checkpoints to place markers, or reopen to adjust anchors.'}
          {selectedLoop && mode === 'checkpoints' && !cpComplete &&
            `Click on the path to place checkpoint ${checkpointTs.length + 1} of ${requiredCpCount} (in sequence).`}
          {selectedLoop && mode === 'checkpoints' && cpComplete &&
            'All checkpoints placed! Use Link mode to connect shared sensors, then copy the export.'}
          {mode === 'link' && !pendingLink &&
            'Click any checkpoint (from any loop) to start linking. Linked sensors will render as a split-color ring in the circuit view.'}
        </p>

        {/* ── Canvas ── */}
        <div className="border border-slate-200 rounded-xl overflow-hidden bg-slate-50 shadow-sm">
          <svg
            ref={svgRef}
            viewBox={`${VB.x} ${VB.y} ${VB.w} ${VB.h}`}
            className="w-full select-none"
            style={{
              maxHeight: 520,
              cursor:
                mode === 'draw' && !closed ? 'crosshair' :
                mode === 'checkpoints'      ? 'cell' :
                mode === 'link'             ? 'pointer' :
                'default',
            }}
            onClick={handleSvgClick}
            onMouseMove={handleSvgMouseMove}
            onMouseUp={handleSvgMouseUp}
            onMouseLeave={() => { setMousePos(null); setPreviewSnap(null); draggingIdx.current = null; }}
          >
            {/* Background grid */}
            <defs>
              <pattern id="geo-grid" width="50" height="50" patternUnits="userSpaceOnUse">
                <path d="M 50 0 L 0 0 0 50" fill="none" stroke="#e2e8f0" strokeWidth="0.5" />
              </pattern>
            </defs>
            <rect x={VB.x} y={VB.y} width={VB.w} height={VB.h} fill="url(#geo-grid)" />

            {/* Existing geo loops — faint background + hidden ref paths for link-mode position lookup */}
            {loops.map((l) => {
              const geo = loopGeometry[l.id];
              if (!geo || !validateLoopGeo(geo, l.checkpoints.length, l.id)) return null;
              const loopIdx = loops.findIndex((x) => x.id === l.id);
              const c = geo.color ?? LOOP_DEFAULT_COLORS[loopIdx % LOOP_DEFAULT_COLORS.length];
              return (
                <g key={l.id}>
                  {/* Visible faint background */}
                  <path
                    d={geo.d} fill="none" stroke={c} strokeWidth={3}
                    opacity={l.id === selectedLoopId ? 0 : 0.12}
                  />
                  {/* Hidden ref path for getPointAtLength in link mode */}
                  <path
                    d={geo.d} fill="none" stroke="none"
                    ref={(el) => { if (el) geoPathRefs.current.set(l.id, el); }}
                  />
                </g>
              );
            })}

            {/* Current session loop path */}
            {currentPath && (
              <path
                ref={drawnPathRef}
                d={currentPath}
                fill="none" stroke={color} strokeWidth={4}
                strokeLinecap="round" strokeLinejoin="round"
                opacity={closed ? 0.85 : 0.55}
              />
            )}

            {/* Preview line: last anchor → mouse */}
            {mode === 'draw' && !closed && anchors.length > 0 && mousePos && (
              <line
                x1={anchors[anchors.length - 1].x} y1={anchors[anchors.length - 1].y}
                x2={mousePos.x} y2={mousePos.y}
                stroke={color} strokeWidth={2} strokeDasharray="7 5" opacity={0.45}
              />
            )}

            {/* Anchor points (draw mode) */}
            {mode === 'draw' && anchors.map((a, i) => (
              <g key={i}>
                {i === 0 && anchors.length >= 3 && !closed && (
                  <circle cx={a.x} cy={a.y} r={CLOSE_THRESHOLD}
                    fill={color} opacity={0.08} stroke={color} strokeWidth={1} strokeDasharray="5 4" />
                )}
                <circle cx={a.x} cy={a.y} r={ANCHOR_R}
                  fill={i === 0 ? color : '#ffffff'} stroke={color} strokeWidth={2}
                  style={{ cursor: 'move' }}
                  onMouseDown={(e) => handleAnchorMouseDown(e, i)}
                  onClick={(e) => e.stopPropagation()}
                />
                <text x={a.x} y={a.y + 1} textAnchor="middle" dominantBaseline="middle"
                  fontSize="7" fontWeight="bold" fill={i === 0 ? '#fff' : color}
                  style={{ pointerEvents: 'none' }}>
                  {i + 1}
                </text>
              </g>
            ))}

            {/* Checkpoint snap preview (checkpoint mode) */}
            {mode === 'checkpoints' && previewSnap && checkpointTs.length < requiredCpCount && (
              <circle cx={previewSnap.x} cy={previewSnap.y} r={CP_MARKER_R}
                fill="none" stroke={color} strokeWidth={2} strokeDasharray="4 3" opacity={0.6} />
            )}

            {/* Placed checkpoint markers (checkpoint mode) */}
            {mode === 'checkpoints' && drawnPathRef.current && pathL > 0 &&
              checkpointTs.map((t, i) => {
                const raw = drawnPathRef.current!.getPointAtLength(Math.min(Math.max(t, 0), 0.9999) * pathL);
                return (
                  <g key={i}>
                    <circle cx={raw.x} cy={raw.y} r={CP_MARKER_R} fill="#fff" stroke={color} strokeWidth={2.5} />
                    <text x={raw.x} y={raw.y + 1} textAnchor="middle" dominantBaseline="middle"
                      fontSize="8" fontWeight="bold" fill={color} style={{ pointerEvents: 'none' }}>
                      {i + 1}
                    </text>
                  </g>
                );
              })
            }

            {/* ── Link mode overlay ── */}
            {mode === 'link' && (
              <g>
                {/* Link connectors between linked checkpoints */}
                {links.map((group, gi) => {
                  const pts = group.map((ref) => {
                    if (loopGeometry[ref.loopId]) return getGeoLoopCpPos(ref.loopId, ref.index);
                    if (ref.loopId === selectedLoopId) return getCurrentSessionCpPos(ref.index);
                    return null;
                  }).filter((p): p is Point => p !== null);

                  return pts.length >= 2 ? (
                    <g key={`link-conn-${gi}`}>
                      {pts.slice(1).map((pt, i) => (
                        <line key={i}
                          x1={pts[i].x} y1={pts[i].y} x2={pt.x} y2={pt.y}
                          stroke="#7c3aed" strokeWidth={1.5} strokeDasharray="5 4" opacity={0.6}
                        />
                      ))}
                    </g>
                  ) : null;
                })}

                {/* Clickable checkpoint targets */}
                {linkTargets.map(({ loopId, cpIdx, pos, color: cpColor }) => {
                  const key      = `${loopId}:${cpIdx}`;
                  const isPending = pendingKey === key;
                  const isLinked  = linkedKeys.has(key);
                  return (
                    <g key={key} onClick={(e) => { e.stopPropagation(); handleLinkClick(loopId, cpIdx); }}
                      style={{ cursor: 'pointer' }}>
                      {isPending && (
                        <circle cx={pos.x} cy={pos.y} r={CP_MARKER_R + 9}
                          fill="none" stroke={cpColor} strokeWidth={2} strokeDasharray="5 3" />
                      )}
                      <circle cx={pos.x} cy={pos.y} r={CP_MARKER_R}
                        fill={isLinked ? cpColor : '#ffffff'}
                        stroke={isPending ? '#7c3aed' : cpColor} strokeWidth={2.5}
                        opacity={isLinked ? 0.8 : 1}
                      />
                      <text x={pos.x} y={pos.y + 1} textAnchor="middle" dominantBaseline="middle"
                        fontSize="8" fontWeight="bold"
                        fill={isLinked ? '#ffffff' : cpColor}
                        style={{ pointerEvents: 'none' }}>
                        {cpIdx + 1}
                      </text>
                      {/* Subtle loop-id label */}
                      <text x={pos.x} y={pos.y + CP_MARKER_R + 9} textAnchor="middle"
                        fontSize="6" fill="#64748b" style={{ pointerEvents: 'none' }}>
                        L{loopId}
                      </text>
                    </g>
                  );
                })}
              </g>
            )}

            {/* Canvas border */}
            <rect x={VB.x} y={VB.y} width={VB.w} height={VB.h} fill="none" stroke="#cbd5e1" strokeWidth={1} />
          </svg>
        </div>

        {/* ── Per-loop export ── */}
        {selectedLoop && closed && (
          <div className="panel-card space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-ink">Loop export</h3>
              <div className="flex items-center gap-3">
                {!cpComplete && (
                  <span className="text-xs text-amber-600">
                    Place {requiredCpCount - checkpointTs.length} more checkpoint{requiredCpCount - checkpointTs.length !== 1 ? 's' : ''} first
                  </span>
                )}
                <button onClick={handleCopyLoop} disabled={!canExport}
                  className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:border-slate-400 hover:bg-slate-50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed">
                  {copiedLoop ? '✓ Copied!' : 'Copy export'}
                </button>
              </div>
            </div>
            <pre className="rounded-lg bg-slate-900 text-slate-100 text-xs p-4 overflow-auto max-h-40 font-mono leading-relaxed">
              {canExport ? loopExportBlock : `// Complete all ${requiredCpCount} checkpoints to enable export`}
            </pre>
            <p className="text-xs text-ink-faint">
              Paste into <code className="bg-slate-100 px-1 rounded font-mono">client/src/loopGeometry.ts</code> inside the <code className="bg-slate-100 px-1 rounded font-mono">loopGeometry</code> object.
            </p>
          </div>
        )}

        {/* ── Shared links export (always visible once in link mode or links exist) ── */}
        {(mode === 'link' || links.length > 0) && (
          <div className="panel-card space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-ink">Shared checkpoint links</h3>
                <p className="text-xs text-ink-faint mt-0.5">
                  {links.length === 0 ? 'No links defined — use Link mode above.' : `${links.length} group${links.length !== 1 ? 's' : ''} · ${links.flatMap((g) => g).length} checkpoint refs`}
                </p>
              </div>
              <button onClick={handleCopyLinks}
                className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:border-slate-400 hover:bg-slate-50 transition-colors">
                {copiedLinks ? '✓ Copied!' : 'Copy links'}
              </button>
            </div>
            <pre className="rounded-lg bg-slate-900 text-slate-100 text-xs p-4 overflow-auto max-h-32 font-mono leading-relaxed">
              {linksExportBlock}
            </pre>
            <p className="text-xs text-ink-faint">
              Paste into <code className="bg-slate-100 px-1 rounded font-mono">client/src/loopGeometry.ts</code>, replacing the existing <code className="bg-slate-100 px-1 rounded font-mono">sharedCheckpointGroups</code> export.
            </p>
          </div>
        )}

        {/* ── Instructions (no loop selected) ── */}
        {!selectedLoop && (
          <div className="panel-card text-xs text-ink-faint space-y-1.5 leading-relaxed">
            <p className="font-semibold text-ink text-sm mb-2">How to use this editor</p>
            <p>① Select a loop above. ② Draw path: click to place anchor points along the real track shape (bends go anywhere). Click the first anchor or press "Close loop" to finish. ③ Checkpoints mode: click near the path to place each checkpoint in order. ④ Link mode: click a checkpoint in one loop then a checkpoint in another to mark them as the same physical sensor. ⑤ Copy each export block and paste into <code className="bg-slate-100 px-1 rounded">loopGeometry.ts</code>. ⑥ Reload the dashboard to see the Overall Circuit section update.</p>
          </div>
        )}
      </main>
    </div>
  );
}
