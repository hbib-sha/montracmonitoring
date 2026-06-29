/**
 * Reports page — data recording and analysis for the Montrac monitoring system.
 *
 * Live tab:  Record/Stop, live charts from the active WebSocket stream,
 *            "Mark actual crash" for detection-latency measurement.
 * History:   Select a run → load persisted samples, ETAs, crash markers.
 *            Export CSV / JSON, delete runs, clear all data.
 */
import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../store/useAuth';
import { useLiveState } from '../store/useLiveState';
import { useRecording } from '../store/useRecording';
import { recordingApi } from '../lib/api';
import { downloadUrl } from '../lib/download';
import StatusBar from '../components/StatusBar';
import AlarmBanner from '../components/AlarmBanner';
import { TimeSeriesChart, type TimeSeriesDataPoint } from '../components/charts/TimeSeriesChart';
import { EtaAccuracyChart } from '../components/charts/EtaAccuracyChart';
import type { RecordingRun, CrashMarker, SegmentTiming } from '../../../server/src/types';

// ── Colour constants matching the Tailwind theme ───────────────────────────
const COLORS = {
  blue:   '#2563eb',
  red:    '#dc2626',
  green:  '#16a34a',
  yellow: '#d97706',
  orange: '#ea580c',
};

const LIVE_BUFFER_MAX = 600; // keep up to 10 min of 1-s points in memory

// ── Small modal for "Mark actual crash" ────────────────────────────────────
function CrashMarkerModal({
  loops,
  onClose,
  onMark,
}: {
  loops: { id: number; name: string }[];
  onClose: () => void;
  onMark: (loopId: number, ms: number, note: string) => void;
}) {
  const [loopId, setLoopId] = useState(loops[0]?.id ?? 1);
  const [note, setNote]     = useState('');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-card-md w-full max-w-sm mx-4 p-5">
        <h3 className="text-sm font-semibold text-ink mb-4">Mark Actual Crash</h3>
        <p className="text-xs text-ink-muted mb-4">
          Records <em>now</em> as the ground-truth crash time for the selected loop.
          When the system detects the crash, the detection latency will be computed automatically.
        </p>
        <div className="space-y-3">
          <div>
            <label className="field-label">Loop</label>
            <select
              className="field-input"
              value={loopId}
              onChange={(e) => setLoopId(Number(e.target.value))}
            >
              {loops.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="field-label">Note (optional)</label>
            <input
              className="field-input"
              type="text"
              placeholder="e.g. shuttle manually blocked at CP2"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        </div>
        <div className="flex gap-2 mt-5 justify-end">
          <button className="btn-industrial" onClick={onClose}>Cancel</button>
          <button
            className="btn-danger"
            onClick={() => {
              onMark(loopId, Date.now(), note);
              onClose();
            }}
          >
            Mark Now
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Run list item ──────────────────────────────────────────────────────────
function RunItem({
  run,
  selected,
  onSelect,
  onDelete,
}: {
  run: RecordingRun;
  selected: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const dur = run.endedAt
    ? Math.round((new Date(run.endedAt).getTime() - new Date(run.startedAt).getTime()) / 1000)
    : null;

  return (
    <button
      onClick={onSelect}
      className={`w-full text-left rounded-lg border px-3 py-2.5 transition-colors ${
        selected
          ? 'border-accent-blue bg-blue-50'
          : 'border-line bg-white hover:bg-slate-50'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-ink truncate">{run.name}</span>
        <span
          className={`shrink-0 text-xs font-semibold px-1.5 py-0.5 rounded ${
            run.status === 'recording'
              ? 'bg-red-100 text-red-600'
              : 'bg-slate-100 text-ink-muted'
          }`}
        >
          {run.status === 'recording' ? '● REC' : 'Stopped'}
        </span>
      </div>
      <div className="flex items-center gap-3 mt-1 text-xs text-ink-faint">
        <span>{new Date(run.startedAt).toLocaleString()}</span>
        {dur !== null && <span>{dur}s</span>}
        <span className="uppercase">{run.mode}</span>
        {(run.sampleCount ?? 0) > 0 && <span>{run.sampleCount} samples</span>}
      </div>
      <button
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        className="mt-1.5 text-xs text-ink-faint hover:text-accent-red transition-colors"
      >
        Delete
      </button>
    </button>
  );
}

// ── System health summary ──────────────────────────────────────────────────
function HealthSummary({ markers }: { markers: CrashMarker[] }) {
  const paired   = markers.filter((m) => m.detectionLatencyMs !== undefined);
  const unpaired = markers.filter((m) => m.detectionLatencyMs === undefined);

  if (markers.length === 0) {
    return (
      <p className="text-sm text-ink-muted">No crash markers recorded in this run.</p>
    );
  }

  const lats = paired.map((m) => m.detectionLatencyMs!);
  const avg  = lats.length > 0 ? lats.reduce((a, b) => a + b, 0) / lats.length : null;
  const max  = lats.length > 0 ? Math.max(...lats) : null;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-3">
        <div className="panel-card text-center">
          <p className="text-2xl font-mono font-bold text-ink">{markers.length}</p>
          <p className="text-xs text-ink-muted mt-0.5">Total markers</p>
        </div>
        <div className="panel-card text-center">
          <p className={`text-2xl font-mono font-bold ${avg !== null && avg > 5000 ? 'text-accent-red' : 'text-accent-green'}`}>
            {avg !== null ? `${(avg / 1000).toFixed(2)}s` : '—'}
          </p>
          <p className="text-xs text-ink-muted mt-0.5">Mean detection latency</p>
        </div>
        <div className="panel-card text-center">
          <p className="text-2xl font-mono font-bold text-accent-yellow">
            {max !== null ? `${(max / 1000).toFixed(2)}s` : '—'}
          </p>
          <p className="text-xs text-ink-muted mt-0.5">Max detection latency</p>
        </div>
      </div>

      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="text-left text-ink-faint">
            <th className="pb-1 pr-3">Loop</th>
            <th className="pb-1 pr-3">Actual crash at</th>
            <th className="pb-1 pr-3">Detected at</th>
            <th className="pb-1 pr-3">Latency</th>
            <th className="pb-1">Note</th>
          </tr>
        </thead>
        <tbody>
          {markers.map((m) => (
            <tr key={m.id} className="border-t border-line">
              <td className="py-1 pr-3 font-mono">L{m.loopId}</td>
              <td className="py-1 pr-3">{new Date(m.actualCrashAtMs).toLocaleTimeString()}</td>
              <td className="py-1 pr-3">
                {m.detectedAtMs ? new Date(m.detectedAtMs).toLocaleTimeString() : <span className="text-ink-faint">not yet detected</span>}
              </td>
              <td className={`py-1 pr-3 font-mono ${m.detectionLatencyMs !== undefined && m.detectionLatencyMs > 5000 ? 'text-accent-red' : 'text-accent-green'}`}>
                {m.detectionLatencyMs !== undefined ? `${(m.detectionLatencyMs / 1000).toFixed(2)}s` : '—'}
              </td>
              <td className="py-1 text-ink-muted truncate max-w-[180px]">{m.note || '—'}</td>
            </tr>
          ))}
          {unpaired.length > 0 && (
            <tr>
              <td colSpan={5} className="pt-2 text-xs text-ink-faint">
                {unpaired.length} marker(s) awaiting a matching system-detected crash
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────
type Tab = 'live' | 'history';

export default function ReportsPage() {
  const navigate = useNavigate();
  const { username, logout } = useAuth();
  const { system, recordingStatus } = useLiveState();

  const {
    runs, selectedRunDetail,
    fetchStatus, fetchRuns, start, stop, selectRun, clearSelection,
    markCrash, deleteRun, clearAll,
  } = useRecording();

  const [tab, setTab]           = useState<Tab>('live');
  const [runName, setRunName]   = useState('');
  const [showMarkerModal, setShowMarkerModal] = useState(false);
  const [confirmClear, setConfirmClear]       = useState(false);

  // Live chart data accumulated from systemState stream
  const liveDataRef = useRef<TimeSeriesDataPoint[]>([]);
  const [liveData, setLiveData] = useState<TimeSeriesDataPoint[]>([]);

  useEffect(() => {
    fetchStatus();
    fetchRuns();
  }, [fetchStatus, fetchRuns]);

  // Accumulate live data points from the systemState WebSocket stream
  useEffect(() => {
    if (!system || !recordingStatus.active) return;

    const pt: TimeSeriesDataPoint = {
      t:       Date.now(),
      active:  system.loops.reduce((n, l) => n + l.shuttles.filter((s) => s.status !== 'crashed').length, 0),
      crashed: system.loops.reduce((n, l) => n + l.shuttles.filter((s) => s.status === 'crashed').length, 0),
      loops:   system.loops.length,
    };

    liveDataRef.current = [...liveDataRef.current, pt].slice(-LIVE_BUFFER_MAX);
    setLiveData([...liveDataRef.current]);
  }, [system, recordingStatus.active]);

  // Clear live buffer when recording stops
  useEffect(() => {
    if (!recordingStatus.active) {
      liveDataRef.current = [];
      setLiveData([]);
    }
  }, [recordingStatus.active]);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const handleStart = async () => {
    const name = runName.trim() || `Run ${new Date().toLocaleString()}`;
    await start(name);
    setRunName('');
  };

  const handleMarkCrash = async (loopId: number, ms: number, note: string) => {
    const runId = recordingStatus.run?.id;
    if (!runId) return;
    await markCrash(runId, loopId, ms, note);
  };

  // Compute aggregate stats for history tab
  const detail = selectedRunDetail;
  const histSamples = detail?.samples ?? [];

  // Convert samples into time-series points for history charts
  const histData: TimeSeriesDataPoint[] = histSamples.map((s) => ({
    t:       s.t,
    active:  s.activeShuttleCount,
    crashed: s.crashedCount,
  }));

  const histSegments: SegmentTiming[] = detail?.segments ?? [];
  const histCrashes: CrashMarker[]   = detail?.crashes ?? [];

  // System health from samples
  const connectedPct = histSamples.length > 0
    ? Math.round((histSamples.filter((s) => s.connected).length / histSamples.length) * 100)
    : null;

  return (
    <div className="flex flex-col h-full min-h-screen bg-surface">
      {/* Top nav */}
      <nav className="border-b border-line bg-white px-4 py-2.5 flex items-center justify-between shrink-0 shadow-sm">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold tracking-tight text-ink">Montrac Monitor</span>
          <span className="text-line">│</span>
          <StatusBar />
          {recordingStatus.active && (
            <span className="flex items-center gap-1.5 text-xs font-semibold text-red-600 animate-pulse-slow">
              <span className="h-2 w-2 rounded-full bg-red-500" />
              REC
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate('/')}
            className="rounded border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors"
          >
            Dashboard
          </button>
          <button
            onClick={() => navigate('/settings')}
            className="rounded border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors"
          >
            Settings
          </button>
          <span className="text-xs text-slate-400 hidden sm:block px-1">{username}</span>
          <button onClick={handleLogout} className="text-xs text-slate-400 hover:text-red-500 transition-colors">
            Logout
          </button>
        </div>
      </nav>

      <AlarmBanner />

      <main className="flex-1 overflow-auto p-4">
        {/* Page header + tab switcher */}
        <div className="flex items-center justify-between mb-5">
          <h1 className="text-lg font-semibold text-ink">Reports & Recording</h1>
          <div className="flex gap-1 rounded-lg border border-line bg-white p-1 shadow-card">
            {(['live', 'history'] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-4 py-1.5 rounded text-xs font-semibold transition-colors capitalize ${
                  tab === t
                    ? 'bg-accent-blue text-white shadow-sm'
                    : 'text-ink-muted hover:text-ink'
                }`}
              >
                {t === 'live' ? 'Live' : 'History'}
              </button>
            ))}
          </div>
        </div>

        {/* ── LIVE TAB ──────────────────────────────────────────────── */}
        {tab === 'live' && (
          <div className="space-y-5">
            {/* Record control panel */}
            <section>
              <h2 className="text-xs font-semibold tracking-widest uppercase text-slate-400 mb-3">
                Recording Control
              </h2>
              <div className="panel-card">
                {!recordingStatus.active ? (
                  <div className="flex items-center gap-3">
                    <input
                      className="field-input flex-1"
                      placeholder="Run name (optional)"
                      value={runName}
                      onChange={(e) => setRunName(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleStart()}
                    />
                    <button className="btn-success shrink-0" onClick={handleStart}>
                      ● Start Recording
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-sm font-semibold text-red-600 flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-full bg-red-500 animate-pulse" />
                        Recording: <span className="font-mono">{recordingStatus.run?.name}</span>
                      </p>
                      <p className="text-xs text-ink-muted mt-0.5">
                        Started {recordingStatus.run?.startedAt
                          ? new Date(recordingStatus.run.startedAt).toLocaleTimeString()
                          : '—'}&nbsp;·&nbsp;
                        Mode: {recordingStatus.run?.mode?.toUpperCase()}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        className="btn-warning"
                        onClick={() => setShowMarkerModal(true)}
                        title="Record the ground-truth crash time (will be paired with detected crash)"
                      >
                        ⚠ Mark Crash
                      </button>
                      <button className="btn-danger" onClick={stop}>
                        ■ Stop
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </section>

            {/* Live charts */}
            {recordingStatus.active && (
              <>
                <section>
                  <h2 className="text-xs font-semibold tracking-widest uppercase text-slate-400 mb-3">
                    Live — Shuttle Activity
                  </h2>
                  <div className="panel-card">
                    <TimeSeriesChart
                      data={liveData}
                      series={[
                        { key: 'active',  label: 'Active shuttles',  color: COLORS.blue  },
                        { key: 'crashed', label: 'Crashed shuttles', color: COLORS.red   },
                      ]}
                    />
                  </div>
                </section>

                <section>
                  <h2 className="text-xs font-semibold tracking-widest uppercase text-slate-400 mb-3">
                    Live — System State
                  </h2>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="panel-card text-center">
                      <p className="text-2xl font-mono font-bold text-ink">
                        {system?.loops.length ?? 0}
                      </p>
                      <p className="text-xs text-ink-muted mt-0.5">Active loops</p>
                    </div>
                    <div className="panel-card text-center">
                      <p className={`text-2xl font-mono font-bold ${system?.connected ? 'text-accent-green' : 'text-accent-red'}`}>
                        {system?.connected ? 'OK' : 'DISC'}
                      </p>
                      <p className="text-xs text-ink-muted mt-0.5">PLC connection</p>
                    </div>
                    <div className="panel-card text-center">
                      <p className="text-2xl font-mono font-bold text-accent-blue">
                        {system?.mode?.toUpperCase() ?? '—'}
                      </p>
                      <p className="text-xs text-ink-muted mt-0.5">Mode</p>
                    </div>
                  </div>
                </section>
              </>
            )}

            {!recordingStatus.active && (
              <div className="panel-card flex items-center justify-center h-48 text-ink-faint text-sm">
                Enter a run name and press <span className="font-semibold mx-1">Start Recording</span> to capture live data.
              </div>
            )}
          </div>
        )}

        {/* ── HISTORY TAB ───────────────────────────────────────────── */}
        {tab === 'history' && (
          <div className="grid grid-cols-[260px_1fr] gap-5 min-h-[60vh]">
            {/* Runs sidebar */}
            <aside className="space-y-2">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-semibold tracking-widest uppercase text-slate-400">Runs</span>
                <button
                  className="text-xs text-accent-red hover:underline"
                  onClick={() => setConfirmClear(true)}
                >
                  Clear all
                </button>
              </div>
              {runs.length === 0 && (
                <p className="text-xs text-ink-faint">No runs recorded yet.</p>
              )}
              {runs.map((r) => (
                <RunItem
                  key={r.id}
                  run={r}
                  selected={detail?.run.id === r.id}
                  onSelect={() => selectRun(r.id)}
                  onDelete={() => deleteRun(r.id)}
                />
              ))}
            </aside>

            {/* Detail panel */}
            <div className="space-y-5">
              {!detail && (
                <div className="panel-card flex items-center justify-center h-64 text-ink-faint text-sm">
                  Select a run from the list to view its report.
                </div>
              )}

              {detail && (
                <>
                  {/* Run header */}
                  <div className="panel-card flex items-start justify-between gap-4">
                    <div>
                      <h2 className="text-base font-semibold text-ink">{detail.run.name}</h2>
                      <p className="text-xs text-ink-muted mt-0.5">
                        {new Date(detail.run.startedAt).toLocaleString()}
                        {detail.run.endedAt && ` → ${new Date(detail.run.endedAt).toLocaleString()}`}
                        &nbsp;·&nbsp;{detail.run.mode.toUpperCase()}
                        &nbsp;·&nbsp;{detail.samples.length} samples
                        &nbsp;·&nbsp;{detail.segments.length} transits
                      </p>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button
                        className="btn-industrial"
                        onClick={() => downloadUrl(recordingApi.exportUrl(detail.run.id, 'csv'), `run-${detail.run.id}.csv`)}
                      >
                        Export CSV
                      </button>
                      <button
                        className="btn-industrial"
                        onClick={() => downloadUrl(recordingApi.exportUrl(detail.run.id, 'json'), `run-${detail.run.id}.json`)}
                      >
                        Export JSON
                      </button>
                      <button
                        className="btn-danger"
                        onClick={() => { deleteRun(detail.run.id); clearSelection(); }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>

                  {/* System health summary */}
                  <section>
                    <h2 className="text-xs font-semibold tracking-widest uppercase text-slate-400 mb-3">
                      System Health
                    </h2>
                    <div className="panel-card">
                      {histSamples.length > 0 ? (
                        <div className="grid grid-cols-3 gap-3">
                          <div className="text-center">
                            <p className={`text-2xl font-mono font-bold ${connectedPct === 100 ? 'text-accent-green' : 'text-accent-yellow'}`}>
                              {connectedPct}%
                            </p>
                            <p className="text-xs text-ink-muted mt-0.5">PLC connection uptime</p>
                          </div>
                          <div className="text-center">
                            <p className="text-2xl font-mono font-bold text-accent-blue">
                              {detail.run.mode.toUpperCase()}
                            </p>
                            <p className="text-xs text-ink-muted mt-0.5">Mode at start</p>
                          </div>
                          <div className="text-center">
                            <p className="text-2xl font-mono font-bold text-ink">
                              {histSamples.length}
                            </p>
                            <p className="text-xs text-ink-muted mt-0.5">Samples recorded</p>
                          </div>
                        </div>
                      ) : (
                        <p className="text-sm text-ink-muted">No samples in this run.</p>
                      )}
                    </div>
                  </section>

                  {/* Shuttle activity over time */}
                  <section>
                    <h2 className="text-xs font-semibold tracking-widest uppercase text-slate-400 mb-3">
                      Shuttle Activity
                    </h2>
                    <div className="panel-card">
                      <TimeSeriesChart
                        data={histData}
                        series={[
                          { key: 'active',  label: 'Active shuttles',  color: COLORS.blue },
                          { key: 'crashed', label: 'Crashed shuttles', color: COLORS.red  },
                        ]}
                      />
                    </div>
                  </section>

                  {/* ETA accuracy */}
                  <section>
                    <h2 className="text-xs font-semibold tracking-widest uppercase text-slate-400 mb-3">
                      ETA Accuracy — Predicted vs Actual segment transit time
                    </h2>
                    <div className="panel-card">
                      <EtaAccuracyChart segments={histSegments} />
                    </div>
                    {histSegments.length > 0 && (
                      <div className="mt-3 overflow-x-auto">
                        <table className="w-full text-xs border-collapse">
                          <thead>
                            <tr className="text-left text-ink-faint">
                              <th className="pb-1 pr-3">Loop</th>
                              <th className="pb-1 pr-3">Shuttle</th>
                              <th className="pb-1 pr-3">From→To</th>
                              <th className="pb-1 pr-3">Predicted</th>
                              <th className="pb-1 pr-3">Actual</th>
                              <th className="pb-1">Error</th>
                            </tr>
                          </thead>
                          <tbody>
                            {histSegments.slice(-20).map((s: SegmentTiming) => {
                              const err = s.actualElapsedMs - s.predictedEtaMs;
                              return (
                                <tr key={s.id} className="border-t border-line">
                                  <td className="py-1 pr-3 font-mono">L{s.loopId}</td>
                                  <td className="py-1 pr-3 font-mono">#{s.shuttleId}</td>
                                  <td className="py-1 pr-3 font-mono">{s.fromIndex}→{s.toIndex}</td>
                                  <td className="py-1 pr-3">{(s.predictedEtaMs / 1000).toFixed(2)}s</td>
                                  <td className="py-1 pr-3">{(s.actualElapsedMs / 1000).toFixed(2)}s</td>
                                  <td className={`py-1 font-mono ${err > 0 ? 'text-accent-yellow' : 'text-accent-green'}`}>
                                    {err > 0 ? '+' : ''}{(err / 1000).toFixed(2)}s
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                        {histSegments.length > 20 && (
                          <p className="text-xs text-ink-faint mt-1">Showing last 20 of {histSegments.length} transits</p>
                        )}
                      </div>
                    )}
                  </section>

                  {/* Crash detection latency */}
                  <section>
                    <h2 className="text-xs font-semibold tracking-widest uppercase text-slate-400 mb-3">
                      Crash Detection Latency
                    </h2>
                    <div className="panel-card">
                      <HealthSummary markers={histCrashes} />
                    </div>
                  </section>
                </>
              )}
            </div>
          </div>
        )}
      </main>

      {/* Mark crash modal */}
      {showMarkerModal && recordingStatus.run && (
        <CrashMarkerModal
          loops={system?.loops.map((l) => ({ id: l.id, name: l.name })) ?? []}
          onClose={() => setShowMarkerModal(false)}
          onMark={handleMarkCrash}
        />
      )}

      {/* Confirm clear all */}
      {confirmClear && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-card-md w-full max-w-xs mx-4 p-5">
            <h3 className="text-sm font-semibold text-ink mb-2">Clear all recording data?</h3>
            <p className="text-xs text-ink-muted mb-4">
              This permanently deletes all runs, samples, segment timings, and crash markers.
            </p>
            <div className="flex gap-2 justify-end">
              <button className="btn-industrial" onClick={() => setConfirmClear(false)}>Cancel</button>
              <button className="btn-danger" onClick={() => { clearAll(); setConfirmClear(false); }}>
                Delete all
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
