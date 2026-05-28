'use client';

import { useState, useCallback } from 'react';
import { RefreshCw, Wifi, WifiOff, AlertTriangle } from 'lucide-react';
import { useVisibilityPolling } from '@/lib/use-visibility-polling';

type ProviderName = 'infobip' | 'smsto' | 'txg';

interface BalanceRow {
  name: ProviderName;
  label: string;
  isConfigured: boolean;
  isActive: boolean;
  balance: number | null;
  currency: string | null;
  fetchedAt: string;
  error?: string;
}

interface BalancesResponse {
  activeProvider: string;
  balances: BalanceRow[];
}

function relativeFromNow(d: Date | null): string {
  if (!d) return '갱신 전';
  const sec = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  if (sec < 5) return '방금 전';
  if (sec < 60) return `${sec}초 전`;
  const min = Math.floor(sec / 60);
  return `${min}분 전`;
}

export default function ProviderBalanceGrid({ intervalMs = 30000 }: { intervalMs?: number }) {
  const [data, setData] = useState<BalancesResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const fetcher = useCallback(async () => {
    try {
      const res = await fetch('/api/sms-providers/balances');
      if (!res.ok) {
        setErr(`잔액 조회 실패 (HTTP ${res.status})`);
        return;
      }
      const body = (await res.json()) as BalancesResponse;
      setData(body);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '네트워크 오류');
    }
  }, []);

  const { refetch, lastFetchedAt, isFetching } = useVisibilityPolling(fetcher, intervalMs);

  return (
    <div className="card" style={{ marginBottom: '24px' }}>
      <div
        className="card-header"
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
      >
        <h3 style={{ margin: 0 }}>프로바이더 잔액</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
            {data?.activeProvider ? (
              <>
                활성: <strong>{data.activeProvider}</strong> · {' '}
              </>
            ) : null}
            {relativeFromNow(lastFetchedAt)}
          </span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => void refetch()}
            disabled={isFetching}
            aria-label="새로고침"
          >
            <RefreshCw size={14} className={isFetching ? 'spin' : ''} />
            새로고침
          </button>
        </div>
      </div>
      <div className="card-body">
        {err && (
          <div style={{ color: 'var(--status-danger)', marginBottom: '12px' }}>
            <AlertTriangle size={14} /> {err}
          </div>
        )}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: '12px',
          }}
        >
          {(data?.balances ?? []).map((row) => {
            const badgeClass = !row.isConfigured
              ? 'badge-banned'
              : row.error
                ? 'badge-warning'
                : row.isActive
                  ? 'badge-active'
                  : 'badge-muted';
            const statusLabel = !row.isConfigured
              ? '미설정'
              : row.error
                ? '잔액 조회 실패'
                : row.isActive
                  ? '활성 + 연결됨'
                  : '연결됨 (대기)';
            return (
              <div key={row.name} className="card" style={{ margin: 0 }}>
                <div className="card-body" style={{ padding: '14px' }}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: '8px',
                    }}
                  >
                    <strong>{row.label}</strong>
                    {row.isConfigured ? <Wifi size={14} /> : <WifiOff size={14} />}
                  </div>
                  <span className={`badge ${badgeClass}`}>{statusLabel}</span>
                  <p style={{ fontSize: '20px', fontWeight: 700, margin: '8px 0 0' }}>
                    {row.balance !== null
                      ? `${row.balance.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${row.currency ?? ''}`
                      : '-'}
                  </p>
                  {row.error && (
                    <p style={{ fontSize: '11px', color: 'var(--text-muted)', margin: '4px 0 0' }}>
                      {row.error}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
