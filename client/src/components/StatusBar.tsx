import { useLiveState } from '../store/useLiveState';

export default function StatusBar() {
  const { system, connected } = useLiveState();

  const plcConnected = system?.connected ?? false;
  const mode         = system?.mode ?? 'simulation';
  const tagResults   = system?.tagCheckResults ?? {};
  const badTags      = Object.entries(tagResults).filter(([, ok]) => !ok);

  return (
    <div className="flex items-center gap-3 text-xs">
      {/* Socket connection */}
      <span className="flex items-center gap-1.5">
        <span
          className={`status-dot ${
            connected ? 'bg-status-ok animate-pulse-slow' : 'bg-status-error animate-blink'
          }`}
        />
        <span className="text-ink-muted font-medium">
          {connected ? 'Connected' : 'Disconnected'}
        </span>
      </span>

      {/* PLC connection */}
      <span className="flex items-center gap-1.5">
        <span className={`status-dot ${plcConnected ? 'bg-status-ok' : 'bg-slate-300'}`} />
        <span className="text-ink-muted font-medium">
          PLC: {plcConnected ? 'Online' : 'Offline'}
        </span>
      </span>

      {/* Mode badge */}
      <span
        className={`rounded-full px-2 py-0.5 text-[10px] font-bold tracking-widest uppercase ${
          mode === 'simulation'
            ? 'bg-amber-100 text-amber-700 ring-1 ring-amber-300'
            : 'bg-green-100 text-green-700 ring-1 ring-green-300'
        }`}
      >
        {mode === 'simulation' ? 'SIM' : 'LIVE'}
      </span>

      {/* Tag check badge */}
      {badTags.length > 0 && (
        <span className="flex items-center gap-1 text-accent-orange font-medium">
          <span>⚠</span>
          <span>{badTags.length} tag(s) unreadable</span>
        </span>
      )}
    </div>
  );
}
