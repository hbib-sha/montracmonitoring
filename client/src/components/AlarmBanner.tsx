import { useLiveState } from '../store/useLiveState';
import { socket } from '../lib/socket';
import { useAlarmSound } from '../hooks/useAlarmSound';

export default function AlarmBanner() {
  const { alarm, system } = useLiveState();
  useAlarmSound(alarm.state === 'active');

  if (alarm.state !== 'active') return null;

  const acknowledge = () => {
    socket.emit('acknowledgeAlarm');
  };

  const loopName = system?.loops.find((l) => l.id === alarm.loopId)?.name ?? `Loop ${alarm.loopId}`;
  const fromCp   = system?.loops
    .find((l) => l.id === alarm.loopId)
    ?.checkpoints[alarm.segmentFrom ?? 0]?.name ?? `CP${alarm.segmentFrom}`;
  const toCp     = system?.loops
    .find((l) => l.id === alarm.loopId)
    ?.checkpoints[alarm.segmentTo ?? 0]?.name ?? `CP${alarm.segmentTo}`;

  const remaining = alarm.autoOffAtMs
    ? Math.max(0, Math.ceil((alarm.autoOffAtMs - Date.now()) / 1000))
    : null;

  return (
    <div className="border-b-2 border-red-500 bg-red-50 px-4 py-3 flex items-center justify-between animate-alarm">
      <div className="flex items-center gap-3">
        {/* Pulsing dot */}
        <span className="h-4 w-4 rounded-full bg-red-500 animate-blink shrink-0" />
        <div>
          <p className="text-red-700 font-bold text-sm tracking-wider uppercase">
            ⚠ Crash Detected — {loopName}
          </p>
          <p className="text-xs text-red-500 mt-0.5">
            Segment: {fromCp} → {toCp}
            {remaining !== null && ` · Auto-clear in ${remaining}s`}
          </p>
        </div>
      </div>
      <button
        onClick={acknowledge}
        className="shrink-0 rounded-lg border-2 border-red-500 bg-white px-4 py-1.5 text-xs font-bold text-red-600 uppercase tracking-wider hover:bg-red-500 hover:text-white transition-colors active:scale-95"
      >
        Acknowledge
      </button>
    </div>
  );
}
