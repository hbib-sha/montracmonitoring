import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSettings } from '../store/useSettings';
import { useLiveState } from '../store/useLiveState';
import { useCalibration } from '../store/useCalibration';
import type { Settings, TagDef } from '../../../server/src/types';

interface LoopConfig {
  id: number;
  name: string;
  description: string;
  allowedShuttleIds: number[];
}

interface CheckpointConfig {
  id: number;
  loopId: number;
  sequence: number;
  name: string;
  type: string;
  distanceMmToNext: number;
  bufferMs: number;
}

export default function SettingsPage() {
  const navigate = useNavigate();
  const { settings, tags, loading, fetch, updateSettings, updateTag } = useSettings();
  const [form, setForm]         = useState<Partial<Settings>>({});
  const [tagEdits, setTagEdits] = useState<Record<number, Partial<TagDef>>>({});
  const [loops, setLoops]       = useState<LoopConfig[]>([]);
  const [loopEdits, setLoopEdits] = useState<Record<number, string>>({});
  const [checkpoints, setCheckpoints] = useState<CheckpointConfig[]>([]);
  const [cpEdits, setCpEdits]   = useState<Record<number, Partial<CheckpointConfig>>>({});
  const [saved, setSaved]       = useState(false);

  useEffect(() => {
    fetch();
  }, [fetch]);

  const fetchLoops = () => {
    window.fetch('/api/loops')
      .then((r) => r.json())
      .then((data: LoopConfig[]) => {
        setLoops(data);
        const initEdits: Record<number, string> = {};
        data.forEach((l) => {
          initEdits[l.id] = l.allowedShuttleIds.join(', ');
        });
        setLoopEdits(initEdits);
      })
      .catch(() => null);
  };

  const fetchCheckpoints = () => {
    window.fetch('/api/checkpoints')
      .then((r) => r.json())
      .then((data: CheckpointConfig[]) => setCheckpoints(data))
      .catch(() => null);
  };

  useEffect(() => {
    fetchLoops();
    fetchCheckpoints();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (settings) setForm(settings);
  }, [settings]);

  const handleSave = async () => {
    await updateSettings(form);
    for (const [id, data] of Object.entries(tagEdits)) {
      await updateTag(Number(id), data);
    }
    setTagEdits({});
    for (const [id, raw] of Object.entries(loopEdits)) {
      const ids = raw
        .split(',')
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => !isNaN(n) && n > 0);
      await window.fetch(`/api/loops/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allowedShuttleIds: ids }),
      });
    }
    for (const [id, data] of Object.entries(cpEdits)) {
      await window.fetch(`/api/checkpoints/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
    }
    setCpEdits({});
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const setTagField = (id: number, field: keyof TagDef, value: string) => {
    setTagEdits((prev) => ({ ...prev, [id]: { ...prev[id], [field]: value } }));
  };

  const setCpField = (id: number, field: keyof CheckpointConfig, value: number | string) => {
    setCpEdits((prev) => ({ ...prev, [id]: { ...prev[id], [field]: value } }));
    setCheckpoints((prev) =>
      prev.map((cp) => (cp.id === id ? { ...cp, [field]: value } : cp)),
    );
  };

  if (loading || !settings) {
    return (
      <div className="flex h-full min-h-screen items-center justify-center bg-surface text-ink-muted text-sm">
        Loading settings…
      </div>
    );
  }

  // Group checkpoints by loop for display
  const cpsByLoop = loops.map((loop) => ({
    loop,
    checkpoints: checkpoints.filter((cp) => cp.loopId === loop.id),
  }));

  return (
    <div className="min-h-screen bg-surface">
      {/* Nav */}
      <nav className="border-b border-line bg-white px-4 py-2.5 flex items-center gap-4 shadow-sm">
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-1 text-sm text-ink-muted hover:text-ink transition-colors"
        >
          ← Dashboard
        </button>
        <span className="text-line">│</span>
        <span className="text-sm font-semibold text-ink">Settings</span>
      </nav>

      <div className="max-w-4xl mx-auto p-6 space-y-6">
        {/* System settings */}
        <section className="panel-card space-y-4">
          <h2 className="text-xs font-semibold tracking-widest uppercase text-ink-muted border-b border-line pb-2">
            System Configuration
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="field-label">OPC UA Endpoint</label>
              <input
                className="field-input"
                value={form.opcEndpoint ?? ''}
                onChange={(e) => setForm((p) => ({ ...p, opcEndpoint: e.target.value }))}
              />
            </div>
            <div>
              <label className="field-label">Mode</label>
              <select
                className="field-input"
                value={form.mode ?? 'simulation'}
                onChange={(e) => setForm((p) => ({ ...p, mode: e.target.value as 'real' | 'simulation' }))}
              >
                <option value="simulation">Simulation</option>
                <option value="real">Real (OPC UA)</option>
              </select>
            </div>
            <div>
              <label className="field-label">Alarm Auto-Off (ms)</label>
              <input
                type="number"
                className="field-input"
                value={form.alarmAutoOffMs ?? 30000}
                onChange={(e) => setForm((p) => ({ ...p, alarmAutoOffMs: Number(e.target.value) }))}
              />
            </div>
            <div>
              <label className="field-label">Avg Shuttle Speed (mm/s)</label>
              <input
                type="number"
                className="field-input"
                value={form.avgSpeedMmPerSec ?? 200}
                onChange={(e) => setForm((p) => ({ ...p, avgSpeedMmPerSec: Number(e.target.value) }))}
              />
            </div>
            <div>
              <label className="field-label">Light Tower Node ID</label>
              <input
                className="field-input"
                value={form.lightTowerNodeId ?? ''}
                onChange={(e) => setForm((p) => ({ ...p, lightTowerNodeId: e.target.value }))}
                placeholder="ns=7;s=…"
              />
            </div>
            <div>
              <label className="field-label">Buzzer Node ID</label>
              <input
                className="field-input"
                value={form.buzzerNodeId ?? ''}
                onChange={(e) => setForm((p) => ({ ...p, buzzerNodeId: e.target.value }))}
                placeholder="ns=7;s=…"
              />
            </div>
            <div>
              <label className="field-label">Push Button 1 Node ID</label>
              <input
                className="field-input"
                value={form.pushButton1NodeId ?? ''}
                onChange={(e) => setForm((p) => ({ ...p, pushButton1NodeId: e.target.value }))}
                placeholder="ns=7;s=…"
              />
            </div>
          </div>
        </section>

        {/* Loop + checkpoint configuration */}
        {cpsByLoop.map(({ loop, checkpoints: cps }) => (
          <section key={loop.id} className="panel-card space-y-4">
            <h2 className="text-xs font-semibold tracking-widest uppercase text-ink-muted border-b border-line pb-2">
              {loop.name} — Checkpoints &amp; Timing
            </h2>

            {/* Tracked shuttle IDs */}
            <div className="flex items-start gap-4">
              <div className="w-36 shrink-0 pt-1">
                <p className="text-xs font-semibold text-ink-muted uppercase tracking-wide">Tracked IDs</p>
              </div>
              <div className="flex-1">
                <label className="field-label">Shuttle IDs (comma-separated)</label>
                <input
                  className="field-input"
                  value={loopEdits[loop.id] ?? ''}
                  onChange={(e) =>
                    setLoopEdits((prev) => ({ ...prev, [loop.id]: e.target.value }))
                  }
                  placeholder="e.g. 2"
                />
                <p className="text-xs text-ink-faint mt-1">
                  Only these IDs will be tracked at IRM_ID checkpoints. Leave empty for all IDs.
                  Requires server restart.
                </p>
              </div>
            </div>

            {/* Checkpoint rows */}
            {cps.length === 0 ? (
              <p className="text-sm text-ink-faint">No checkpoints configured for this loop.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-line text-xs text-ink-faint">
                      <th className="text-left py-2 pr-3 font-semibold w-8">#</th>
                      <th className="text-left py-2 pr-3 font-semibold">Name</th>
                      <th className="text-left py-2 pr-3 font-semibold w-16">Type</th>
                      <th className="text-left py-2 pr-3 font-semibold w-40">
                        Distance to Next (mm)
                        <span className="block font-normal text-ink-faint normal-case tracking-normal">
                          used for ETA calculation
                        </span>
                      </th>
                      <th className="text-left py-2 font-semibold w-40">
                        Crash Buffer (ms)
                        <span className="block font-normal text-ink-faint normal-case tracking-normal">
                          grace period beyond ETA
                        </span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {cps.map((cp) => (
                      <tr key={cp.id} className="border-b border-line last:border-0 hover:bg-surface">
                        <td className="py-2 pr-3 text-ink-faint font-mono text-xs">{cp.sequence + 1}</td>
                        <td className="py-2 pr-3 font-medium text-ink text-xs">{cp.name}</td>
                        <td className="py-2 pr-3">
                          <span className="rounded border border-line bg-surface px-1.5 py-0.5 text-[10px] font-mono font-semibold text-ink-muted uppercase">
                            {cp.type}
                          </span>
                        </td>
                        <td className="py-2 pr-3">
                          <input
                            type="number"
                            min={1}
                            className="field-input py-1 text-xs w-32"
                            value={cp.distanceMmToNext}
                            onChange={(e) =>
                              setCpField(cp.id, 'distanceMmToNext', parseInt(e.target.value, 10) || 1)
                            }
                          />
                        </td>
                        <td className="py-2">
                          <input
                            type="number"
                            min={0}
                            step={500}
                            className="field-input py-1 text-xs w-32"
                            value={cp.bufferMs}
                            onChange={(e) =>
                              setCpField(cp.id, 'bufferMs', parseInt(e.target.value, 10) || 0)
                            }
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {cps.length > 0 && (
              <p className="text-xs text-ink-faint">
                ETA (ms) = Distance ÷ Avg Speed × 1000. Crash fires if shuttle hasn't arrived within ETA + Buffer.
              </p>
            )}

            {cps.length > 0 && (
              <LoopCalibration loopId={loop.id} loopName={loop.name} onApplied={fetchCheckpoints} />
            )}
          </section>
        ))}

        {/* Tag address configuration */}
        <section className="panel-card">
          <h2 className="text-xs font-semibold tracking-widest uppercase text-ink-muted border-b border-line pb-2 mb-4">
            Tag Addresses
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-ink-faint border-b border-line">
                  <th className="text-left py-2 pr-4 font-semibold text-xs">Logical Name</th>
                  <th className="text-left py-2 pr-4 font-semibold text-xs">Node ID</th>
                  <th className="text-left py-2 pr-4 font-semibold text-xs">Type</th>
                  <th className="text-left py-2 font-semibold text-xs">Description</th>
                </tr>
              </thead>
              <tbody>
                {tags.map((tag) => (
                  <tr key={tag.id} className="border-b border-line hover:bg-surface">
                    <td className="py-2 pr-4 font-mono font-semibold text-xs text-blue-600">
                      {tag.logicalName}
                    </td>
                    <td className="py-2 pr-4">
                      <input
                        className="field-input text-xs py-1"
                        defaultValue={tag.nodeId}
                        onBlur={(e) => {
                          if (e.target.value !== tag.nodeId) {
                            setTagField(tag.id, 'nodeId', e.target.value);
                          }
                        }}
                      />
                    </td>
                    <td className="py-2 pr-4 text-xs text-ink-muted font-mono">{tag.dataType}</td>
                    <td className="py-2 text-xs text-ink-faint">{tag.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Save */}
        <div className="flex items-center gap-4 pb-4">
          <button
            onClick={handleSave}
            className="rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 transition-colors active:scale-95"
          >
            Save All
          </button>
          {saved && (
            <span className="flex items-center gap-1.5 text-sm text-green-600 font-medium">
              <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
              Saved
            </span>
          )}
          <p className="text-xs text-ink-faint">
            Mode and endpoint changes take effect after server restart.
          </p>
        </div>
      </div>
    </div>
  );
}

function LoopCalibration({
  loopId,
  loopName,
  onApplied,
}: {
  loopId: number;
  loopName: string;
  onApplied: () => void;
}) {
  const mode = useLiveState((s) => s.system?.mode);
  const cal  = useLiveState((s) => s.calibrationStatus);
  const {
    proposal, fetchProposal, start, stop, apply,
    applying, loadingProposal, error, clear,
  } = useCalibration();

  const isReal      = mode === 'real';
  const thisLoop    = cal.loopId === loopId;
  const collecting  = thisLoop && cal.active && !cal.complete;
  const reviewing   = thisLoop && cal.complete;
  const otherActive = cal.active && cal.loopId !== loopId;

  // Fetch the before/after proposal once this loop's calibration completes.
  useEffect(() => {
    if (reviewing && !proposal && !loadingProposal) {
      fetchProposal(loopId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewing, loopId]);

  const handleApply = async () => {
    if (await apply(loopId)) onApplied();
  };

  const handleCancel = async () => {
    await stop();
    clear();
  };

  return (
    <div className="rounded-lg border border-line bg-surface p-3 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-ink uppercase tracking-wide">
            Auto-calibrate distances
          </p>
          <p className="text-xs text-ink-faint">
            Run one shuttle {cal.targetRuns} laps of {loopName}; measured travel times set the
            distances and a 3&nbsp;s crash buffer.
          </p>
        </div>
        {!collecting && !reviewing && (
          <button
            disabled={!isReal || otherActive}
            onClick={() => start(loopId)}
            className="shrink-0 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Start calibration
          </button>
        )}
        {collecting && (
          <button
            onClick={stop}
            className="shrink-0 rounded-lg border border-line bg-white px-4 py-2 text-xs font-semibold text-ink hover:bg-surface transition-colors"
          >
            Stop
          </button>
        )}
      </div>

      {!isReal && (
        <p className="text-xs text-amber-600">Available in real (OPC&nbsp;UA) mode only.</p>
      )}
      {isReal && otherActive && (
        <p className="text-xs text-amber-600">Calibration is running on another loop.</p>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}

      {/* Live per-segment progress */}
      {(collecting || reviewing) && cal.segments.length > 0 && (
        <div className="space-y-1">
          {cal.segments.map((seg) => (
            <div key={seg.fromIndex} className="flex items-center gap-2 text-xs">
              <span className="w-44 truncate text-ink-muted">{seg.cpName} →</span>
              <span className="font-mono text-ink-faint">
                {seg.count}/{cal.targetRuns}
              </span>
              {seg.avgMs != null && (
                <span className="font-mono text-ink-muted">avg {(seg.avgMs / 1000).toFixed(1)}s</span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Review before/after, then apply */}
      {reviewing && (
        <div className="space-y-2">
          {loadingProposal && <p className="text-xs text-ink-faint">Computing proposal…</p>}
          {proposal && proposal.length > 0 && (
            <>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-line text-ink-faint">
                    <th className="text-left py-1 pr-3 font-semibold">Checkpoint</th>
                    <th className="text-right py-1 pr-3 font-semibold">Avg time</th>
                    <th className="text-right py-1 pr-3 font-semibold">Current (mm)</th>
                    <th className="text-right py-1 font-semibold">Proposed (mm)</th>
                  </tr>
                </thead>
                <tbody>
                  {proposal.map((row) => (
                    <tr key={row.cpId} className="border-b border-line last:border-0">
                      <td className="py-1 pr-3 text-ink">{row.cpName}</td>
                      <td className="py-1 pr-3 text-right font-mono text-ink-muted">
                        {(row.avgMs / 1000).toFixed(1)}s
                      </td>
                      <td className="py-1 pr-3 text-right font-mono text-ink-faint">
                        {row.currentDistanceMm}
                      </td>
                      <td className="py-1 text-right font-mono font-semibold text-blue-600">
                        {row.proposedDistanceMm}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-xs text-ink-faint">
                Applying writes these distances, sets every crash buffer to 3&nbsp;s, and reloads the
                engine (virtual shuttles respawn on next detection).
              </p>
              <div className="flex items-center gap-3">
                <button
                  onClick={handleApply}
                  disabled={applying}
                  className="rounded-lg bg-green-600 px-4 py-2 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-40 transition-colors"
                >
                  {applying ? 'Applying…' : 'Apply & Save'}
                </button>
                <button onClick={handleCancel} className="text-xs text-ink-muted hover:text-ink">
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
