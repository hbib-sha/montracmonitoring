/**
 * SimulationDialog — draggable floating overlay for simulation control.
 * Replaces the old /simulation full-page route.
 *
 * Layout:
 *  - Draggable via the header bar (mouse down → move tracking on window)
 *  - Input tags (direction 'read'/'readwrite'): overridable by user
 *    Boolean toggles auto-pulse if the tag is a GO signal (~600ms)
 *  - Output tags (direction 'write'): read-only live display (now updated
 *    because SimulatedDriver.write emits tagChanged)
 */
import { useEffect, useRef, useState } from 'react';
import { useLiveState } from '../store/useLiveState';
import { useSettings } from '../store/useSettings';
import { socket } from '../lib/socket';
import type { TagDef } from '../../../server/src/types';

interface Props {
  open: boolean;
  onClose: () => void;
}

// Tags whose logical name contains 'GO' auto-pulse (true → false after 600ms)
function isGoTag(tag: TagDef): boolean {
  return tag.logicalName.toUpperCase().includes('GO');
}

export default function SimulationDialog({ open, onClose }: Props) {
  const { simTags }   = useLiveState();
  const { tags, fetch } = useSettings();

  // Dialog position
  const [pos, setPos] = useState({ x: 40, y: 80 });
  const dragging = useRef(false);
  const dragOffset = useRef({ x: 0, y: 0 });

  useEffect(() => {
    if (open) fetch();
  }, [open, fetch]);

  // ── Drag handlers ──────────────────────────────────────────────────────────
  const onHeaderMouseDown = (e: React.MouseEvent) => {
    dragging.current = true;
    dragOffset.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
    e.preventDefault();
  };

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const nx = Math.max(0, Math.min(window.innerWidth - 480, e.clientX - dragOffset.current.x));
      const ny = Math.max(0, Math.min(window.innerHeight - 120, e.clientY - dragOffset.current.y));
      setPos({ x: nx, y: ny });
    };
    const onUp = () => { dragging.current = false; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  if (!open) return null;

  // ── Tag control helpers ────────────────────────────────────────────────────
  const setTag = (tag: TagDef, value: boolean | number) => {
    socket.emit('simSetTag', { logicalName: tag.logicalName, value });
  };

  const handleBoolClick = (tag: TagDef) => {
    if (isGoTag(tag)) {
      // Auto-pulse: true then auto-reset to false after 600ms
      socket.emit('simSetTag', { logicalName: tag.logicalName, value: true });
      setTimeout(() => {
        socket.emit('simSetTag', { logicalName: tag.logicalName, value: false });
      }, 600);
    } else {
      const current = Boolean(simTags[tag.nodeId]);
      setTag(tag, !current);
    }
  };

  const inputTags  = tags.filter((t) => t.direction === 'read' || t.direction === 'readwrite');
  const outputTags = tags.filter((t) => t.direction === 'write');

  return (
    <div
      className="fixed z-50 w-[520px] max-w-[calc(100vw-16px)] rounded-xl border border-slate-200 bg-white shadow-2xl select-none"
      style={{ left: pos.x, top: pos.y }}
    >
      {/* Header / drag handle */}
      <div
        className="flex items-center justify-between rounded-t-xl bg-slate-800 px-4 py-2.5 cursor-move"
        onMouseDown={onHeaderMouseDown}
      >
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-amber-400" />
          <span className="text-xs font-semibold tracking-widest text-white uppercase">
            Simulation Override Panel
          </span>
        </div>
        <button
          onClick={onClose}
          className="rounded p-0.5 text-slate-400 hover:bg-slate-700 hover:text-white transition-colors"
          title="Close"
        >
          <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
        </button>
      </div>

      {/* Body */}
      <div className="max-h-[70vh] overflow-y-auto p-4 space-y-4">
        <p className="text-xs text-slate-500">
          Set PLC tag values to drive the monitoring engine in simulation mode.
          GO tags pulse automatically — one click releases the shuttle.
        </p>

        {/* Input tags (overridable) */}
        <section>
          <h3 className="mb-2 text-[10px] font-bold tracking-widest text-slate-500 uppercase border-b border-slate-100 pb-1">
            Inputs — override to simulate PLC readings
          </h3>
          <div className="grid grid-cols-2 gap-2">
            {inputTags.map((tag) => {
              const current = simTags[tag.nodeId];
              const isInt   = tag.dataType === 'Int32' || tag.dataType === 'Float';
              const isGo    = isGoTag(tag);
              const boolOn  = Boolean(current);
              return (
                <div
                  key={tag.id}
                  className={`rounded-lg border p-2.5 transition-colors ${
                    boolOn && !isInt
                      ? 'border-emerald-300 bg-emerald-50'
                      : 'border-slate-200 bg-slate-50'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-bold text-slate-700 font-mono">
                      {tag.logicalName}
                    </span>
                    {isGo && (
                      <span className="text-[9px] text-amber-600 font-semibold uppercase tracking-wider">
                        pulse
                      </span>
                    )}
                    {!isInt && !isGo && (
                      <span
                        className={`inline-block h-2 w-2 rounded-full ${
                          boolOn ? 'bg-emerald-500' : 'bg-slate-300'
                        }`}
                      />
                    )}
                  </div>
                  <p className="text-[10px] text-slate-400 mb-2 leading-tight">{tag.description}</p>
                  {isInt ? (
                    <input
                      type="number"
                      className="w-full rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-800 font-mono focus:outline-none focus:ring-1 focus:ring-blue-400"
                      value={typeof current === 'number' ? current : 0}
                      onChange={(e) => setTag(tag, Number(e.target.value))}
                    />
                  ) : (
                    <button
                      onClick={() => handleBoolClick(tag)}
                      className={`w-full rounded py-1.5 text-[10px] font-bold tracking-widest uppercase transition-all ${
                        isGo
                          ? 'bg-amber-500 text-white hover:bg-amber-600 active:scale-95'
                          : boolOn
                          ? 'bg-emerald-500 text-white hover:bg-emerald-600'
                          : 'bg-white border border-slate-300 text-slate-500 hover:border-slate-400 hover:text-slate-700'
                      }`}
                    >
                      {isGo ? '▶ SEND GO' : boolOn ? 'TRUE' : 'FALSE'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* Output tags (read-only live display) */}
        {outputTags.length > 0 && (
          <section>
            <h3 className="mb-2 text-[10px] font-bold tracking-widest text-slate-500 uppercase border-b border-slate-100 pb-1">
              Outputs — written by the system (live)
            </h3>
            <div className="grid grid-cols-3 gap-2">
              {outputTags.map((tag) => {
                const val    = simTags[tag.nodeId];
                const active = Boolean(val);
                return (
                  <div
                    key={tag.id}
                    className={`rounded-lg border p-2.5 transition-colors ${
                      active ? 'border-blue-300 bg-blue-50' : 'border-slate-200 bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] font-bold text-slate-700 font-mono">
                        {tag.logicalName}
                      </span>
                      <span
                        className={`inline-block h-2 w-2 rounded-full ${
                          active ? 'bg-blue-500' : 'bg-slate-300'
                        }`}
                      />
                    </div>
                    <p className="text-[10px] text-slate-400 leading-tight">{tag.description}</p>
                    <p className="mt-1 text-[10px] font-bold text-slate-600 font-mono">
                      {val !== undefined ? String(val) : '—'}
                    </p>
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
