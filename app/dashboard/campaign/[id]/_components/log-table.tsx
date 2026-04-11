'use client';

import { useState, useMemo, useCallback } from 'react';
import { CheckCircle, Clock, XCircle, RotateCcw } from 'lucide-react';

type LogEntry = {
  id: string;
  targetNumber: string;
  status: string;
  providerStatus: string | null;
  networkName: string | null;
  retryCount: number;
  cost: number;
  createdAt: string;
};

type Summary = {
  pending: number;
  sent: number;
  delivered: number;
  failed: number;
  retryPending: number;
};

type Props = {
  logs: LogEntry[];
  summary: Summary;
  campaignId: string;
  campaignStatus: string;
};

const logStatusLabel: Record<string, string> = {
  PENDING: '대기 중',
  SENT: '발송됨',
  DELIVERED: '전달 완료',
  FAILED: '실패',
  RETRY_PENDING: '재시도 대기',
};

type FilterKey = 'ALL' | 'PENDING' | 'SENT' | 'DELIVERED' | 'FAILED' | 'RETRY_PENDING';

const filters: { key: FilterKey; label: string; countKey?: keyof Summary }[] = [
  { key: 'ALL', label: '전체' },
  { key: 'PENDING', label: '대기', countKey: 'pending' },
  { key: 'SENT', label: '발송', countKey: 'sent' },
  { key: 'DELIVERED', label: '전달', countKey: 'delivered' },
  { key: 'FAILED', label: '실패', countKey: 'failed' },
  { key: 'RETRY_PENDING', label: '재시도', countKey: 'retryPending' },
];

const statusBadgeStyle = (status: string): React.CSSProperties => {
  const base: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.375rem',
    padding: '0.25rem 0.75rem',
    borderRadius: '999px',
    fontSize: '0.75rem',
    fontWeight: 600,
  };
  switch (status) {
    case 'DELIVERED':
      return { ...base, backgroundColor: 'rgba(16, 185, 129, 0.1)', color: 'var(--primary)' };
    case 'SENT':
    case 'PENDING':
    case 'RETRY_PENDING':
      return { ...base, backgroundColor: 'rgba(245, 158, 11, 0.1)', color: '#f59e0b' };
    case 'FAILED':
      return { ...base, backgroundColor: 'rgba(239, 68, 68, 0.1)', color: '#ef4444' };
    default:
      return { ...base, backgroundColor: 'rgba(148, 163, 184, 0.1)', color: '#94a3b8' };
  }
};

function formatDateTime(iso: string) {
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

export default function LogTable({ logs, summary, campaignId }: Props) {
  const [activeFilter, setActiveFilter] = useState<FilterKey>('ALL');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [retrying, setRetrying] = useState(false);
  const [retryResult, setRetryResult] = useState<string | null>(null);

  const filteredLogs = useMemo(() => {
    if (activeFilter === 'ALL') return logs;
    return logs.filter((log) => log.status === activeFilter);
  }, [logs, activeFilter]);

  const failedLogIds = useMemo(
    () => new Set(filteredLogs.filter((l) => l.status === 'FAILED').map((l) => l.id)),
    [filteredLogs],
  );

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelectedIds((prev) => {
      if (prev.size === failedLogIds.size && failedLogIds.size > 0) return new Set();
      return new Set(failedLogIds);
    });
  }, [failedLogIds]);

  const handleRetry = useCallback(async () => {
    if (selectedIds.size === 0) return;
    setRetrying(true);
    setRetryResult(null);
    try {
      const res = await fetch(`/api/sms/campaign/${campaignId}/retry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ logIds: Array.from(selectedIds) }),
      });
      const data = await res.json();
      if (res.ok) {
        setRetryResult(data.message);
        setSelectedIds(new Set());
      } else {
        setRetryResult(`오류: ${data.error}`);
      }
    } catch {
      setRetryResult('네트워크 오류가 발생했습니다.');
    } finally {
      setRetrying(false);
    }
  }, [selectedIds, campaignId]);

  const totalCount = logs.length;

  return (
    <>
      {/* 필터 버튼 바 */}
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
        {filters.map((f) => {
          const isActive = activeFilter === f.key;
          const count = f.countKey ? summary[f.countKey] : totalCount;
          return (
            <button
              key={f.key}
              onClick={() => { setActiveFilter(f.key); setSelectedIds(new Set()); }}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.375rem',
                padding: '0.5rem 1rem',
                borderRadius: '0.5rem',
                fontSize: '0.8125rem',
                fontWeight: 500,
                cursor: 'pointer',
                transition: 'all 0.15s',
                backgroundColor: isActive ? 'rgba(16, 185, 129, 0.15)' : 'transparent',
                color: isActive ? 'var(--primary)' : 'var(--text-secondary)',
                border: isActive
                  ? '1px solid rgba(16, 185, 129, 0.3)'
                  : '1px solid var(--border)',
              }}
            >
              {f.label}
              <span style={{
                fontSize: '0.6875rem',
                padding: '0.125rem 0.375rem',
                borderRadius: '999px',
                backgroundColor: isActive ? 'rgba(16, 185, 129, 0.2)' : 'rgba(148, 163, 184, 0.1)',
              }}>
                {count}
              </span>
            </button>
          );
        })}

        {/* 재발송 버튼 (실패 건이 있을 때만) */}
        {summary.failed > 0 && (
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            {retryResult && (
              <span style={{
                fontSize: '0.8125rem',
                color: retryResult.startsWith('오류') ? '#ef4444' : 'var(--primary)',
              }}>
                {retryResult}
              </span>
            )}
            <button
              onClick={handleRetry}
              disabled={retrying || selectedIds.size === 0}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.375rem',
                padding: '0.5rem 1rem',
                borderRadius: '0.5rem',
                fontSize: '0.8125rem',
                fontWeight: 600,
                cursor: retrying || selectedIds.size === 0 ? 'not-allowed' : 'pointer',
                backgroundColor: selectedIds.size > 0 ? 'rgba(59, 130, 246, 0.15)' : 'transparent',
                color: selectedIds.size > 0 ? '#3b82f6' : 'var(--text-secondary)',
                border: selectedIds.size > 0
                  ? '1px solid rgba(59, 130, 246, 0.3)'
                  : '1px solid var(--border)',
                opacity: retrying ? 0.6 : 1,
              }}
            >
              <RotateCcw size={14} style={retrying ? { animation: 'spin 1s linear infinite' } : {}} />
              {retrying ? '처리 중...' : `재발송 (${selectedIds.size}건)`}
            </button>
          </div>
        )}
      </div>

      {/* 테이블 */}
      <div className="glass-card" style={{ padding: '0', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-secondary)', fontSize: '0.75rem', textTransform: 'uppercase' }}>
              {summary.failed > 0 && (
                <th style={{ padding: '1.25rem 0.75rem', fontWeight: 600, width: '40px' }}>
                  <input
                    type="checkbox"
                    checked={selectedIds.size === failedLogIds.size && failedLogIds.size > 0}
                    onChange={toggleSelectAll}
                    style={{ cursor: 'pointer', accentColor: 'var(--primary)' }}
                    title="실패 건 전체 선택"
                  />
                </th>
              )}
              <th style={{ padding: '1.25rem', fontWeight: 600 }}>수신번호</th>
              <th style={{ padding: '1.25rem', fontWeight: 600 }}>상태</th>
              <th style={{ padding: '1.25rem', fontWeight: 600 }}>통신사</th>
              <th style={{ padding: '1.25rem', fontWeight: 600 }}>재시도 횟수</th>
              <th style={{ padding: '1.25rem', fontWeight: 600 }}>발송시간</th>
              <th style={{ padding: '1.25rem', fontWeight: 600, textAlign: 'right' }}>비용</th>
            </tr>
          </thead>
          <tbody>
            {filteredLogs.map((log) => (
              <tr key={log.id} style={{ borderBottom: '1px solid var(--border)' }}>
                {summary.failed > 0 && (
                  <td style={{ padding: '1.25rem 0.75rem' }}>
                    {log.status === 'FAILED' ? (
                      <input
                        type="checkbox"
                        checked={selectedIds.has(log.id)}
                        onChange={() => toggleSelect(log.id)}
                        style={{ cursor: 'pointer', accentColor: 'var(--primary)' }}
                      />
                    ) : (
                      <span />
                    )}
                  </td>
                )}
                <td style={{ padding: '1.25rem', fontSize: '0.875rem', fontWeight: 500 }}>{log.targetNumber}</td>
                <td style={{ padding: '1.25rem' }}>
                  <div style={statusBadgeStyle(log.status)}>
                    {log.status === 'DELIVERED' ? <CheckCircle size={12} /> : log.status === 'FAILED' ? <XCircle size={12} /> : <Clock size={12} />}
                    {logStatusLabel[log.status] || log.status}
                  </div>
                </td>
                <td style={{ padding: '1.25rem', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{log.networkName || log.providerStatus || '-'}</td>
                <td style={{ padding: '1.25rem', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{log.retryCount}</td>
                <td style={{ padding: '1.25rem', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>{formatDateTime(log.createdAt)}</td>
                <td style={{ padding: '1.25rem', fontSize: '0.875rem', fontWeight: 600, textAlign: 'right' }}>${log.cost.toFixed(2)}</td>
              </tr>
            ))}
            {filteredLogs.length === 0 && (
              <tr>
                <td colSpan={summary.failed > 0 ? 7 : 6} style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                  {activeFilter === 'ALL' ? '발송 로그가 없습니다.' : `${filters.find(f => f.key === activeFilter)?.label} 상태의 로그가 없습니다.`}
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <div style={{ padding: '1.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
          <span>
            {activeFilter === 'ALL'
              ? `총 ${totalCount}건`
              : `${filters.find(f => f.key === activeFilter)?.label} ${filteredLogs.length}건 / 총 ${totalCount}건`}
          </span>
          <span>
            대기 {summary.pending} | 발송 {summary.sent} | 전달 {summary.delivered} | 실패 {summary.failed} | 재시도 {summary.retryPending}
          </span>
        </div>
      </div>

      {/* 스핀 애니메이션 */}
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </>
  );
}
