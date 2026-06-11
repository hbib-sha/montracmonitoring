import { useState } from 'react';
import { socket } from '../lib/socket';
import { useSettings } from '../store/useSettings';

interface Props {
  loopId: number;
  loopName: string;
}

type Direction = 'left' | 'straight' | 'right';

export default function ArenaOverride({ loopId, loopName }: Props) {
  const [active, setActive] = useState<Direction | null>(null);
  const { tags }            = useSettings();

  const getNodeId = (logicalName: string): string =>
    tags.find((t) => t.logicalName === logicalName)?.nodeId ?? '';

  const luId = getNodeId('LU_ARENA');
  const stId = getNodeId('ST_ARENA');
  const ruId = getNodeId('RU_ARENA');
  const configured = luId !== '' && stId !== '' && ruId !== '';

  const send = (direction: Direction) => {
    if (!configured) return;
    setActive(direction);
    socket.emit('arenaOverride', {
      loopId,
      direction,
      lu_node_id: luId,
      st_node_id: stId,
      ru_node_id: ruId,
    });
    setTimeout(() => setActive(null), 1500);
  };

  return (
    <div className="panel-card space-y-3">
      <p className="text-xs text-ink-muted font-medium">{loopName}</p>
      {!configured && (
        <p className="text-[10px] text-amber-600 bg-amber-50 border border-amber-200 rounded px-2 py-1">
          Arena tags not configured — set LU_ARENA / ST_ARENA / RU_ARENA node IDs in Settings.
        </p>
      )}

      <div className="grid grid-cols-3 gap-2">
        {/* Left */}
        <button
          onClick={() => send('left')}
          disabled={!configured}
          className={`flex flex-col items-center gap-1 rounded-lg border-2 px-2 py-3 text-xs font-bold tracking-widest uppercase transition-all active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed ${
            active === 'left'
              ? 'border-red-500 bg-red-500 text-white'
              : 'border-red-300 text-red-600 hover:border-red-500 hover:bg-red-50'
          }`}
        >
          <span className="text-xl leading-none">←</span>
          <span>LEFT</span>
        </button>

        {/* Straight */}
        <button
          onClick={() => send('straight')}
          disabled={!configured}
          className={`flex flex-col items-center gap-1 rounded-lg border-2 px-2 py-3 text-xs font-bold tracking-widest uppercase transition-all active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed ${
            active === 'straight'
              ? 'border-blue-500 bg-blue-500 text-white'
              : 'border-blue-300 text-blue-600 hover:border-blue-500 hover:bg-blue-50'
          }`}
        >
          <span className="text-xl leading-none">↑</span>
          <span>STR</span>
        </button>

        {/* Right */}
        <button
          onClick={() => send('right')}
          disabled={!configured}
          className={`flex flex-col items-center gap-1 rounded-lg border-2 px-2 py-3 text-xs font-bold tracking-widest uppercase transition-all active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed ${
            active === 'right'
              ? 'border-green-500 bg-green-500 text-white'
              : 'border-green-300 text-green-600 hover:border-green-500 hover:bg-green-50'
          }`}
        >
          <span className="text-xl leading-none">→</span>
          <span>RIGHT</span>
        </button>
      </div>

      {active && (
        <p className="text-[10px] text-ink-faint text-center tracking-wider animate-pulse">
          Sending {active.toUpperCase()}…
        </p>
      )}
    </div>
  );
}
