import { socket } from '../lib/socket';
import type { CheckpointState } from '../../../server/src/types';

interface Props {
  checkpoint: CheckpointState;
  loopName: string;
}

export default function CheckpointCard({ checkpoint, loopName }: Props) {
  const sendGo = () => {
    socket.emit('sendGo', { checkpointId: checkpoint.id });
  };

  const hasGo = checkpoint.type === 'IRM_ID' || checkpoint.type === 'IRM';

  return (
    <div
      className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-sm transition-all shadow-card ${
        checkpoint.detecting
          ? 'border-green-300 bg-green-50'
          : 'border-line bg-card'
      }`}
    >
      {/* Detect LED */}
      <span
        className={`h-3 w-3 rounded-full shrink-0 ${
          checkpoint.detecting ? 'bg-green-500 animate-pulse-slow' : 'bg-slate-200'
        }`}
      />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-ink truncate">{checkpoint.name}</span>
          <span className="text-ink-faint text-xs hidden sm:block">({loopName})</span>
          <span className="rounded border border-line bg-surface px-1.5 py-0.5 text-[10px] font-mono font-semibold text-ink-muted uppercase tracking-wide">
            {checkpoint.type}
          </span>
        </div>
        {checkpoint.detecting && (
          <p className="text-ink-muted text-xs mt-0.5">
            {checkpoint.type === 'IRM_ID'
              ? `Shuttle ID: ${checkpoint.detectedShuttleId ?? '—'}`
              : 'Detecting shuttle'}
          </p>
        )}
      </div>

      {/* GO button */}
      {hasGo && (
        <button
          onClick={sendGo}
          disabled={!checkpoint.detecting}
          className={`shrink-0 rounded-lg border-2 px-3 py-1.5 text-xs font-bold tracking-widest uppercase transition-all active:scale-95 ${
            checkpoint.goSignalActive
              ? 'border-green-500 bg-green-500 text-white'
              : 'border-green-400 text-green-600 hover:bg-green-500 hover:text-white hover:border-green-500 disabled:opacity-30 disabled:cursor-not-allowed'
          }`}
        >
          {checkpoint.goSignalActive ? '▶ GO!' : 'GO'}
        </button>
      )}
    </div>
  );
}
