/**
 * ETA Accuracy scatter chart: predicted ETA vs actual elapsed time per shuttle transit.
 * Points on the diagonal = perfect prediction. Above = over-estimated, below = under.
 */
import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Legend,
} from 'recharts';
import type { SegmentTiming } from '../../../../server/src/types';

interface Props {
  segments: SegmentTiming[];
  height?: number;
}

export function EtaAccuracyChart({ segments, height = 260 }: Props) {
  if (segments.length === 0) {
    return (
      <div className="flex items-center justify-center text-ink-faint text-sm" style={{ height }}>
        No segment timings yet
      </div>
    );
  }

  // Group by loopId for multi-colored scatter series
  const byLoop = segments.reduce<Record<number, { x: number; y: number; shuttle: number }[]>>(
    (acc, s) => {
      if (!acc[s.loopId]) acc[s.loopId] = [];
      acc[s.loopId].push({
        x: s.predictedEtaMs / 1000,   // seconds
        y: s.actualElapsedMs / 1000,
        shuttle: s.shuttleId,
      });
      return acc;
    },
    {},
  );

  const loopColors: Record<number, string> = {
    1: '#2563eb', // accent.blue
    2: '#ea580c', // accent.orange
    3: '#16a34a', // accent.green
  };
  const loopIds = Object.keys(byLoop).map(Number);

  // Compute stats
  const diffs = segments.map((s) => s.actualElapsedMs - s.predictedEtaMs);
  const meanDiff = diffs.reduce((a, b) => a + b, 0) / diffs.length;
  const maxX = Math.max(...segments.map((s) => s.predictedEtaMs / 1000), 0) * 1.1;

  return (
    <div>
      <ResponsiveContainer width="100%" height={height}>
        <ScatterChart margin={{ top: 8, right: 16, left: 0, bottom: 16 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis
            type="number"
            dataKey="x"
            name="Predicted (s)"
            unit="s"
            domain={[0, maxX]}
            tick={{ fontSize: 11, fill: '#94a3b8' }}
            label={{ value: 'Predicted ETA (s)', position: 'insideBottom', offset: -8, style: { fontSize: 11, fill: '#94a3b8' } }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            type="number"
            dataKey="y"
            name="Actual (s)"
            unit="s"
            tick={{ fontSize: 11, fill: '#94a3b8' }}
            label={{ value: 'Actual (s)', angle: -90, position: 'insideLeft', style: { fontSize: 11, fill: '#94a3b8' } }}
            tickLine={false}
            axisLine={false}
            width={40}
          />
          <Tooltip
            contentStyle={{ fontSize: 12, borderColor: '#e2e8f0', borderRadius: 8 }}
            formatter={(v: number) => [`${v.toFixed(2)} s`]}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {/* Perfect-prediction diagonal */}
          <ReferenceLine
            segment={[{ x: 0, y: 0 }, { x: maxX, y: maxX }]}
            stroke="#94a3b8"
            strokeDasharray="4 3"
            label={{ value: 'Perfect', position: 'insideTopRight', fontSize: 10, fill: '#94a3b8' }}
          />
          {loopIds.map((lid) => (
            <Scatter
              key={lid}
              name={`Loop ${lid}`}
              data={byLoop[lid]}
              fill={loopColors[lid] ?? '#6366f1'}
              fillOpacity={0.7}
            />
          ))}
        </ScatterChart>
      </ResponsiveContainer>
      <p className="text-xs text-ink-muted text-center mt-1">
        Mean ETA error: <span className={meanDiff > 0 ? 'text-accent-yellow' : 'text-accent-green'}>
          {meanDiff > 0 ? '+' : ''}{(meanDiff / 1000).toFixed(2)} s
        </span>
        &nbsp;({segments.length} transits)
      </p>
    </div>
  );
}
