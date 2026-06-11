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

  const send = (direction: Direction) => {
    setActive(direction);
    socket.emit('arenaOverride', {
      loopId,
      direction,
      lu_node_id: getNodeId('LU_ARENA'),
      st_node_id: getNodeId('ST_ARENA'),
      ru_node_id: getNodeId('RU_ARENA'),
    });
    setTimeout(() => setActive(null), 1500);
  };

  return (
    <div className="panel-card space-y-3">
      <p className="text-xs text-ink-muted font-medium">{loopName}</p>
      <div className="grid grid-cols-3 gap-2">
        {/* Left */}
        <button
          onClick={() => send('left')}
          className={`flex flex-col items-center gap-1 rounded-lg border-2 px-2 py-3 text-xs font-bold tracking-widest uppercase transition-all active:scale-95 ${
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
          className={`flex flex-col items-center gap-1 rounded-lg border-2 px-2 py-3 text-xs font-bold tracking-widest uppercase transition-all active:scale-95 ${
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
          className={`flex flex-col items-center gap-1 rounded-lg border-2 px-2 py-3 text-xs font-bold tracking-widest uppercase transition-all active:scale-95 ${
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
