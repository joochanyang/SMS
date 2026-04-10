import { TrendingUp, TrendingDown } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

interface StatCardProps {
  title: string;
  value: number | string;
  change?: number;
  icon: LucideIcon;
  color: 'emerald' | 'blue' | 'amber' | 'red';
}

export default function StatCard({ title, value, change, icon: Icon, color }: StatCardProps) {
  const formattedValue =
    typeof value === 'number' ? value.toLocaleString('ko-KR') : value;

  return (
    <div className="stat-card">
      <div className="stat-card-content">
        <span className="stat-card-label">{title}</span>
        <span className="stat-card-value">{formattedValue}</span>
        {change !== undefined && (
          <span className={`stat-card-change ${change >= 0 ? 'positive' : 'negative'}`}>
            {change >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
            {change >= 0 ? '+' : ''}
            {change.toFixed(1)}%
          </span>
        )}
      </div>
      <div className={`stat-card-icon ${color}`}>
        <Icon size={22} />
      </div>
    </div>
  );
}
