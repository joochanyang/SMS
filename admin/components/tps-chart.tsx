'use client';

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

interface TpsChartProps {
  data: Array<{ time: string; tps: number }>;
}

export default function TpsChart({ data }: TpsChartProps) {
  return (
    <ResponsiveContainer>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(30,41,59,0.5)" />
        <XAxis
          dataKey="time"
          stroke="#64748B"
          fontSize={12}
          tickLine={false}
        />
        <YAxis
          stroke="#64748B"
          fontSize={12}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip
          contentStyle={{
            background: '#0F172A',
            border: '1px solid rgba(30,41,59,0.5)',
            borderRadius: '8px',
            fontSize: '13px',
          }}
          labelStyle={{ color: '#94A3B8' }}
        />
        <Line
          type="monotone"
          dataKey="tps"
          stroke="#10B981"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4, fill: '#10B981' }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
