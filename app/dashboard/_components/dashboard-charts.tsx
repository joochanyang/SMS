'use client';

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
} from 'recharts';

type DailyStat = {
  date: string;
  sent: number;
  delivered: number;
  failed: number;
};

type StatusItem = {
  name: string;
  value: number;
  color: string;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload) return null;
  return (
    <div
      style={{
        backgroundColor: 'rgba(15, 23, 42, 0.95)',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: '8px',
        padding: '0.75rem 1rem',
        fontSize: '0.8rem',
      }}
    >
      <div style={{ color: '#94a3b8', marginBottom: '0.25rem' }}>{label}</div>
      {payload.map((entry: { name: string; value: number; color: string }, i: number) => (
        <div key={i} style={{ color: entry.color, display: 'flex', justifyContent: 'space-between', gap: '1rem' }}>
          <span>{entry.name}</span>
          <span style={{ fontWeight: 600 }}>{entry.value}건</span>
        </div>
      ))}
    </div>
  );
}

export function DailyChart({ data }: { data: DailyStat[] }) {
  const hasData = data.some((d) => d.sent > 0);

  return (
    <div
      style={{
        backgroundColor: 'rgba(15, 23, 42, 0.4)',
        border: '1px solid var(--border)',
        borderRadius: '12px',
        padding: '1.5rem',
        marginBottom: '2rem',
      }}
    >
      <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1.5rem' }}>
        일별 발송 추이
      </h3>
      {!hasData ? (
        <div
          style={{
            height: '280px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--text-secondary)',
            fontSize: '0.875rem',
          }}
        >
          아직 발송 데이터가 없습니다.
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={280}>
          <AreaChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
            <defs>
              <linearGradient id="gradSent" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="gradDelivered" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="gradFailed" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis
              dataKey="date"
              tick={{ fill: '#94a3b8', fontSize: 12 }}
              axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: '#94a3b8', fontSize: 12 }}
              axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
              tickLine={false}
              allowDecimals={false}
            />
            <Tooltip content={<CustomTooltip />} />
            <Area
              type="monotone"
              dataKey="sent"
              name="발송"
              stroke="#3b82f6"
              fill="url(#gradSent)"
              strokeWidth={2}
            />
            <Area
              type="monotone"
              dataKey="delivered"
              name="전달 완료"
              stroke="#10b981"
              fill="url(#gradDelivered)"
              strokeWidth={2}
            />
            <Area
              type="monotone"
              dataKey="failed"
              name="실패"
              stroke="#ef4444"
              fill="url(#gradFailed)"
              strokeWidth={2}
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

export function StatusPieChart({ data }: { data: StatusItem[] }) {
  const total = data.reduce((sum, item) => sum + item.value, 0);
  const pieData = data.map((d) => ({ ...d, fill: d.color }));

  return (
    <div
      style={{
        backgroundColor: 'rgba(15, 23, 42, 0.4)',
        border: '1px solid var(--border)',
        borderRadius: '12px',
        padding: '1.5rem',
        flex: 1,
        minWidth: 0,
      }}
    >
      <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1rem' }}>
        상태별 분포
      </h3>
      {total === 0 ? (
        <div
          style={{
            height: '240px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--text-secondary)',
            fontSize: '0.875rem',
          }}
        >
          데이터가 없습니다.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div style={{ position: 'relative', width: '200px', height: '200px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={85}
                  dataKey="value"
                  stroke="none"
                />
                <Tooltip
                  formatter={(value: unknown, name: unknown) => [`${value}건`, String(name)]}
                  contentStyle={{
                    backgroundColor: 'rgba(15, 23, 42, 0.95)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '8px',
                    fontSize: '0.8rem',
                  }}
                  itemStyle={{ color: '#e2e8f0' }}
                />
              </PieChart>
            </ResponsiveContainer>
            {/* 중앙 텍스트 */}
            <div
              style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                textAlign: 'center',
                pointerEvents: 'none',
              }}
            >
              <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>{total.toLocaleString()}</div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>총 건수</div>
            </div>
          </div>

          {/* 범례 */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', marginTop: '1rem', justifyContent: 'center' }}>
            {data.map((item, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', fontSize: '0.8rem' }}>
                <div
                  style={{
                    width: '10px',
                    height: '10px',
                    borderRadius: '50%',
                    backgroundColor: item.color,
                  }}
                />
                <span style={{ color: 'var(--text-secondary)' }}>
                  {item.name} ({item.value})
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
