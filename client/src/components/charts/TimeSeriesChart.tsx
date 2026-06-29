/**
 * Generic line/area time-series chart using recharts.
 * Used for active shuttle count, crashed count, etc. over a recording run.
 */
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts';

export interface TimeSeriesDataPoint {
  t: number;        // epoch ms
  [key: string]: number;
}

export interface TimeSeriesSeries {
  key: string;
  label: string;
  color: string;
}

interface Props {
  data: TimeSeriesDataPoint[];
  series: TimeSeriesSeries[];
  height?: number;
  yLabel?: string;
}

function formatTime(t: number): string {
  return new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function TimeSeriesChart({ data, series, height = 220, yLabel }: Props) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center text-ink-faint text-sm" style={{ height }}>
        No data yet
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
        <defs>
          {series.map((s) => (
            <linearGradient key={s.key} id={`grad-${s.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor={s.color} stopOpacity={0.15} />
              <stop offset="95%" stopColor={s.color} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis
          dataKey="t"
          tickFormatter={formatTime}
          tick={{ fontSize: 11, fill: '#94a3b8' }}
          tickLine={false}
          axisLine={false}
          minTickGap={60}
        />
        <YAxis
          tick={{ fontSize: 11, fill: '#94a3b8' }}
          tickLine={false}
          axisLine={false}
          label={yLabel ? { value: yLabel, angle: -90, position: 'insideLeft', style: { fontSize: 11, fill: '#94a3b8' } } : undefined}
          allowDecimals={false}
          width={32}
        />
        <Tooltip
          contentStyle={{ fontSize: 12, borderColor: '#e2e8f0', borderRadius: 8 }}
          labelFormatter={(v) => formatTime(Number(v))}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {series.map((s) => (
          <Area
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.label}
            stroke={s.color}
            fill={`url(#grad-${s.key})`}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}
