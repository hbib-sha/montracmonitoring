import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../store/useAuth';
import { useLiveState } from '../store/useLiveState';
import { useSettings } from '../store/useSettings';
import StatusBar from '../components/StatusBar';
import AlarmBanner from '../components/AlarmBanner';
import ArenaOverride from '../components/ArenaOverride';
import LoopVisualizer from '../components/LoopVisualizer';
import CombinedTrackCanvas from '../components/CombinedTrackCanvas';
import CheckpointCard from '../components/CheckpointCard';
import SimulationDialog from '../components/SimulationDialog';
import { loopGeometry, validateLoopGeo } from '../loopGeometry';

export default function DashboardPage() {
  const { username, logout } = useAuth();
  const { system }           = useLiveState();
  const { fetch: fetchSettings } = useSettings();
  const navigate             = useNavigate();
  const [simOpen, setSimOpen] = useState(false);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div className="flex flex-col h-full min-h-screen bg-surface">
      {/* Top nav */}
      <nav className="border-b border-line bg-white px-4 py-2.5 flex items-center justify-between shrink-0 shadow-sm">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold tracking-tight text-ink">
            Montrac Monitor
          </span>
          <span className="text-line">│</span>
          <StatusBar />
        </div>
        <div className="flex items-center gap-2">
          {system?.mode === 'simulation' && (
            <button
              onClick={() => setSimOpen(true)}
              className="flex items-center gap-1.5 rounded border border-amber-400 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-100 transition-colors"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
              Sim Panel
            </button>
          )}
          <button
            onClick={() => navigate('/geometry')}
            className="rounded border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-500 hover:border-slate-300 hover:bg-slate-50 transition-colors"
            title="Author real-shape loop geometry for the circuit view"
          >
            Circuit Editor
          </button>
          <button
            onClick={() => navigate('/settings')}
            className="rounded border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:border-slate-300 hover:bg-slate-50 transition-colors"
          >
            Settings
          </button>
          <span className="text-xs text-slate-400 hidden sm:block px-1">{username}</span>
          <button
            onClick={handleLogout}
            className="text-xs text-slate-400 hover:text-red-500 transition-colors"
          >
            Logout
          </button>
        </div>
      </nav>

      {/* Alarm banner */}
      <AlarmBanner />

      {/* Main content */}
      <main className="flex-1 overflow-auto p-4 space-y-5">
        {/* Overall Circuit — shown only when at least one loop has authored geometry */}
        {system?.loops.some((l) => {
          const geo = loopGeometry[l.id];
          return geo && validateLoopGeo(geo, l.checkpoints.length, l.id);
        }) && (
          <section>
            <h2 className="text-xs font-semibold tracking-widest uppercase text-slate-400 mb-3">
              Overall Circuit
            </h2>
            <CombinedTrackCanvas loops={system.loops} />
          </section>
        )}

        {/* Row 1: Loop visualizers */}
        <section>
          <h2 className="text-xs font-semibold tracking-widest uppercase text-slate-400 mb-3">
            Loop Monitoring
          </h2>
          {system?.loops.length ? (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              {system.loops.map((loop) => (
                <LoopVisualizer key={loop.id} loop={loop} />
              ))}
            </div>
          ) : (
            <div className="panel-card text-center text-slate-400 text-sm py-8">
              No loops configured
            </div>
          )}
        </section>

        {/* Row 2: Checkpoint cards + Arena override */}
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Checkpoint cards */}
          <div className="lg:col-span-2 space-y-2">
            <h2 className="text-xs font-semibold tracking-widest uppercase text-slate-400 mb-3">
              Checkpoints
            </h2>
            {system?.loops.flatMap((loop) =>
              loop.checkpoints.map((cp) => (
                <CheckpointCard
                  key={cp.id}
                  checkpoint={cp}
                  loopName={loop.name}
                />
              )),
            )}
          </div>

          {/* Arena override — one shared arena for all loops */}
          <div>
            <h2 className="text-xs font-semibold tracking-widest uppercase text-slate-400 mb-3">
              Arena Override
            </h2>
            <ArenaOverride />
          </div>
        </section>
      </main>

      {/* Draggable simulation dialog (sim mode only) */}
      <SimulationDialog open={simOpen} onClose={() => setSimOpen(false)} />
    </div>
  );
}
