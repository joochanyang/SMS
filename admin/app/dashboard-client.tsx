'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Send,
  CheckCircle,
  XCircle,
  DollarSign,

  Database,
  Power,
  AlertTriangle,
} from 'lucide-react';
import dynamic from 'next/dynamic';

const TpsChart = dynamic(() => import('@/components/tps-chart'), {
  loading: () => <div style={{ width: '100%', height: 280, background: 'var(--surface-hover)', borderRadius: '8px', animation: 'pulse 1.5s ease-in-out infinite' }} />,
  ssr: false,
});
import Sidebar from '@/components/sidebar';
import Header from '@/components/header';
import StatCard from '@/components/stat-card';

interface ProviderStatRow {
  provider: string;
  sent: number;
  delivered: number;
  failed: number;
  pending: number;
  deliveryRate: number;
}

interface ProviderStats {
  '24h': ProviderStatRow[];
  '7d': ProviderStatRow[];
  // 레거시(providerName=null) 로그 — 전달률 집계에서 자동 제외되므로 UX 침묵 방지
  unclassified: {
    total: number;
    last24h: number;
  };
  // 최근 24h에 TXG 폴링 한도 초과로 DELIVERY_UNKNOWN 처리된 건수
  deliveryUnknown24h: number;
}

interface DashboardStats {
  totalSent: number;
  totalSentChange: number;
  successRate: number;
  successRateChange: number;
  failed: number;
  failedChange: number;
  totalCost: number;
  totalCostChange: number;
  tpsData: { time: string; tps: number }[];
  activeCampaigns: {
    id: string;
    userName: string;
    messagePreview: string;
    total: number;
    sent: number;
    failed: number;
    status: string;
  }[];
  systemStatus: {
    infobip: string;
    database: string;
    killSwitch: boolean;
  };
  recentAlerts: {
    id: string;
    action: string;
    adminEmail: string;
    result: string;
    createdAt: string;
  }[];
  providerStats: ProviderStats;
}

// 프로바이더 코드 → 화면 표시명 매핑
const PROVIDER_LABEL: Record<string, string> = {
  infobip: 'Infobip',
  smsto: 'SMS.to',
  txg: 'TXG-TEL',
};

// 전달률 임계값에 따른 CSS 변수 색상 선택 (>=90% 초록, >=70% 주황, <70% 빨강)
function getDeliveryRateColor(rate: number): string {
  if (rate >= 0.9) return 'var(--status-success)';
  if (rate >= 0.7) return 'var(--status-warning)';
  return 'var(--status-danger)';
}

interface AdminInfo {
  name: string;
  username: string;
  role: string;
}

export default function DashboardClient() {
  const router = useRouter();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [admin, setAdmin] = useState<AdminInfo | null>(null);
  const [loading, setLoading] = useState(true);
  // 프로바이더별 전달률 윈도우 탭 상태 (최근 24시간 / 7일)
  const [providerWindow, setProviderWindow] = useState<'24h' | '7d'>('24h');

  const fetchData = useCallback(async () => {
    try {
      const [sessionRes, statsRes] = await Promise.all([
        fetch('/api/auth/session'),
        fetch('/api/dashboard/stats'),
      ]);

      if (!sessionRes.ok) {
        router.push('/login');
        return;
      }

      const sessionData = await sessionRes.json();
      setAdmin(sessionData.admin);

      if (statsRes.ok) {
        const raw = await statsRes.json();
        // API 응답을 클라이언트 형태로 매핑
        const totalSent = raw.today?.totalSent ?? raw.totalSent ?? 0;
        const successCount = raw.today?.successCount ?? 0;
        const failedCount = raw.today?.failedCount ?? raw.failed ?? 0;
        const successRate = totalSent > 0 ? (successCount / totalSent) * 100 : (raw.successRate ?? 0);
        setStats({
          totalSent,
          totalSentChange: parseFloat(raw.comparison?.sentChange ?? raw.totalSentChange ?? '0'),
          successRate,
          successRateChange: parseFloat(raw.comparison?.successChange ?? raw.successRateChange ?? '0'),
          failed: failedCount,
          failedChange: parseFloat(raw.comparison?.failedChange ?? raw.failedChange ?? '0'),
          totalCost: raw.today?.totalCost ?? raw.totalCost ?? 0,
          totalCostChange: parseFloat(raw.comparison?.costChange ?? raw.totalCostChange ?? '0'),
          tpsData: raw.tpsData ?? [],
          activeCampaigns: Array.isArray(raw.activeCampaigns) ? raw.activeCampaigns : [],
          systemStatus: {
            infobip: raw.system?.infobip ?? raw.systemStatus?.infobip ?? 'unknown',
            database: raw.system?.database ?? raw.systemStatus?.database ?? 'unknown',
            killSwitch:
              raw.system?.killSwitch === true ||
              raw.system?.killSwitchLevel === 'GLOBAL_STOP' ||
              raw.system?.killSwitchLevel === 'GLOBAL_PAUSE' ||
              raw.systemStatus?.killSwitch === true,
          },
          recentAlerts: (raw.recentAlerts ?? []).map((a: Record<string, string>) => ({
            id: a.id,
            action: a.action,
            adminEmail: a.adminEmail,
            result: a.result ?? a.reason ?? '',
            createdAt: a.createdAt ?? a.timestamp ?? '',
          })),
          providerStats: {
            '24h': Array.isArray(raw.providerStats?.['24h']) ? raw.providerStats['24h'] : [],
            '7d': Array.isArray(raw.providerStats?.['7d']) ? raw.providerStats['7d'] : [],
            unclassified: {
              total: Number(raw.providerStats?.unclassified?.total ?? 0),
              last24h: Number(raw.providerStats?.unclassified?.last24h ?? 0),
            },
            deliveryUnknown24h: Number(raw.providerStats?.deliveryUnknown24h ?? 0),
          },
        });
      } else {
        setStats({
          totalSent: 0,
          totalSentChange: 0,
          successRate: 0,
          successRateChange: 0,
          failed: 0,
          failedChange: 0,
          totalCost: 0,
          totalCostChange: 0,
          tpsData: [],
          activeCampaigns: [],
          systemStatus: { infobip: 'unknown', database: 'unknown', killSwitch: false },
          recentAlerts: [],
          providerStats: {
            '24h': [],
            '7d': [],
            unclassified: { total: 0, last24h: 0 },
            deliveryUnknown24h: 0,
          },
        });
      }
    } catch (e) {
      // 인증 오류는 위 `sessionRes.ok` 분기에서 이미 처리됨.
      // 여기서는 네트워크 장애, JSON 파싱 오류, 매핑 오류 등이 잡히므로
      // 로그인으로 무조건 돌리지 않는다 (서버 장애를 "로그인 만료"로 둔갑시키는 silent failure 방지).
      console.error('[dashboard] 통계 조회 실패', e);
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  if (loading || !admin) {
    return (
      <div className="loading-center" style={{ minHeight: '100vh' }}>
        <span className="spinner spinner-lg" />
      </div>
    );
  }

  const killSwitchActive = stats?.systemStatus?.killSwitch ?? false;

  return (
    <div className="admin-layout">
      <Sidebar
        adminName={admin.name}
        adminEmail={admin.username}
        adminRole={admin.role}
        killSwitchActive={killSwitchActive}
      />
      <div className="admin-main">
        <Header
          title="대시보드"
          killSwitchActive={killSwitchActive}
          adminName={admin.name}
        />
        <main className="admin-content">
          {/* Stat Cards */}
          <div className="stat-cards-row">
            <StatCard
              title="오늘 발송"
              value={stats?.totalSent ?? 0}
              change={stats?.totalSentChange}
              icon={Send}
              color="blue"
            />
            <StatCard
              title="성공률"
              value={stats ? `${stats.successRate.toFixed(1)}%` : '0%'}
              change={stats?.successRateChange}
              icon={CheckCircle}
              color="emerald"
            />
            <StatCard
              title="실패"
              value={stats?.failed ?? 0}
              change={stats?.failedChange}
              icon={XCircle}
              color="red"
            />
            <StatCard
              title="오늘 비용"
              value={stats ? `\u20A9${stats.totalCost.toLocaleString('ko-KR')}` : '\u20A90'}
              change={stats?.totalCostChange}
              icon={DollarSign}
              color="amber"
            />
          </div>

          {/* TPS Chart */}
          <div className="chart-card">
            <h3 className="chart-card-title">발송 TPS (최근 1시간)</h3>
            <div style={{ width: '100%', height: 280 }}>
              <TpsChart data={stats?.tpsData ?? []} />
            </div>
          </div>

          {/* Active Campaigns */}
          <div className="card" style={{ marginBottom: '24px' }}>
            <div className="card-header">
              <h3>진행 중인 캠페인</h3>
            </div>
            {stats?.activeCampaigns.length === 0 ? (
              <div className="table-empty" style={{ padding: '32px' }}>
                <div className="table-empty-text">진행 중인 캠페인이 없습니다</div>
              </div>
            ) : (
              <div className="data-table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>사용자</th>
                      <th>메시지</th>
                      <th>진행률</th>
                      <th>발송/전체</th>
                      <th>상태</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats?.activeCampaigns.map((c) => {
                      const progress = c.total > 0 ? ((c.sent / c.total) * 100) : 0;
                      return (
                        <tr
                          key={c.id}
                          className="clickable"
                          onClick={() => router.push(`/campaigns/${c.id}`)}
                        >
                          <td style={{ color: 'var(--text-main)' }}>{c.userName}</td>
                          <td>
                            <span className="message-preview">{c.messagePreview}</span>
                          </td>
                          <td style={{ minWidth: '140px' }}>
                            <div className="progress-bar">
                              <div
                                className="progress-bar-fill info"
                                style={{ width: `${progress}%` }}
                              />
                            </div>
                            <span className="progress-text">{progress.toFixed(1)}%</span>
                          </td>
                          <td>
                            {c.sent.toLocaleString('ko-KR')} / {c.total.toLocaleString('ko-KR')}
                          </td>
                          <td>
                            <span className={`badge ${c.status === 'QUEUED' ? 'badge-pending' : 'badge-sending'}`}>
                              <span className="badge-dot" />
                              {c.status === 'QUEUED' ? '대기열' : '발송 중'}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* SMS 프로바이더별 전달률 */}
          <div className="section-header" style={{ marginTop: '24px' }}>
            <h3 className="section-title">SMS 프로바이더별 전달률</h3>
          </div>
          <div className="card" style={{ marginBottom: '24px' }}>
            <div
              className="card-header"
              style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}
            >
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  className={`badge ${providerWindow === '24h' ? 'badge-sending' : 'badge-pending'}`}
                  style={{
                    padding: '6px 14px',
                    cursor: 'pointer',
                    border: 'none',
                    background:
                      providerWindow === '24h'
                        ? 'var(--accent-primary, rgba(59, 130, 246, 0.2))'
                        : 'var(--surface-hover)',
                    color:
                      providerWindow === '24h' ? 'var(--text-main)' : 'var(--text-muted)',
                  }}
                  onClick={() => setProviderWindow('24h')}
                >
                  최근 24시간
                </button>
                <button
                  type="button"
                  className={`badge ${providerWindow === '7d' ? 'badge-sending' : 'badge-pending'}`}
                  style={{
                    padding: '6px 14px',
                    cursor: 'pointer',
                    border: 'none',
                    background:
                      providerWindow === '7d'
                        ? 'var(--accent-primary, rgba(59, 130, 246, 0.2))'
                        : 'var(--surface-hover)',
                    color:
                      providerWindow === '7d' ? 'var(--text-main)' : 'var(--text-muted)',
                  }}
                  onClick={() => setProviderWindow('7d')}
                >
                  최근 7일
                </button>
              </div>
            </div>
            {(() => {
              const rows = stats?.providerStats?.[providerWindow] ?? [];
              if (rows.length === 0) {
                return (
                  <div className="table-empty" style={{ padding: '32px' }}>
                    <div className="table-empty-text">아직 발송 내역이 없습니다.</div>
                  </div>
                );
              }
              return (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
                    gap: '16px',
                    padding: '16px',
                  }}
                >
                  {rows.map((row) => {
                    const label = PROVIDER_LABEL[row.provider] ?? row.provider;
                    const percent = (row.deliveryRate * 100).toFixed(1);
                    const color = getDeliveryRateColor(row.deliveryRate);
                    const barWidth = Math.max(0, Math.min(100, row.deliveryRate * 100));
                    return (
                      <div
                        key={row.provider}
                        style={{
                          background: 'var(--surface-hover)',
                          borderRadius: '8px',
                          padding: '16px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '12px',
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                          }}
                        >
                          <span style={{ color: 'var(--text-main)', fontWeight: 600 }}>
                            {label}
                          </span>
                          <span
                            style={{
                              color,
                              fontWeight: 700,
                              fontSize: '18px',
                            }}
                          >
                            {percent}%
                          </span>
                        </div>
                        <div
                          className="progress-bar"
                          style={{ background: 'var(--surface-base, rgba(255,255,255,0.05))' }}
                        >
                          <div
                            className="progress-bar-fill"
                            style={{ width: `${barWidth}%`, background: color }}
                          />
                        </div>
                        <div
                          style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(2, 1fr)',
                            gap: '8px',
                            fontSize: '13px',
                            color: 'var(--text-muted)',
                          }}
                        >
                          <div>
                            <div style={{ color: 'var(--text-muted)' }}>발송 시도</div>
                            <div style={{ color: 'var(--text-main)', fontWeight: 600 }}>
                              {row.sent.toLocaleString('ko-KR')}
                            </div>
                          </div>
                          <div>
                            <div style={{ color: 'var(--text-muted)' }}>전달 완료</div>
                            <div style={{ color: 'var(--status-success)', fontWeight: 600 }}>
                              {row.delivered.toLocaleString('ko-KR')}
                            </div>
                          </div>
                          <div>
                            <div style={{ color: 'var(--text-muted)' }}>실패</div>
                            <div style={{ color: 'var(--status-danger)', fontWeight: 600 }}>
                              {row.failed.toLocaleString('ko-KR')}
                            </div>
                          </div>
                          <div>
                            <div style={{ color: 'var(--text-muted)' }}>대기 중</div>
                            <div style={{ color: 'var(--status-warning)', fontWeight: 600 }}>
                              {row.pending.toLocaleString('ko-KR')}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>

          {/* 미분류 + DELIVERY_UNKNOWN 서브 카드 — 전달률 집계에 포함되지 않는 사각지대 가시화 */}
          {(() => {
            const unclassified = stats?.providerStats?.unclassified ?? {
              total: 0,
              last24h: 0,
            };
            const deliveryUnknown24h = stats?.providerStats?.deliveryUnknown24h ?? 0;
            if (
              unclassified.total === 0 &&
              unclassified.last24h === 0 &&
              deliveryUnknown24h === 0
            ) {
              return null;
            }
            return (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
                  gap: '12px',
                  marginBottom: '24px',
                }}
              >
                {unclassified.total > 0 && (
                  <div
                    className="card"
                    style={{
                      padding: '14px 16px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '4px',
                    }}
                  >
                    <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                      미분류 로그 (레거시)
                    </div>
                    <div
                      style={{
                        fontSize: '20px',
                        fontWeight: 700,
                        color: 'var(--text-main)',
                      }}
                    >
                      {unclassified.total.toLocaleString('ko-KR')}건
                      {unclassified.last24h > 0 && (
                        <span
                          style={{
                            fontSize: '13px',
                            color: 'var(--text-muted)',
                            fontWeight: 400,
                            marginLeft: '8px',
                          }}
                        >
                          (최근 24h: {unclassified.last24h.toLocaleString('ko-KR')}건)
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                      providerName 미기록 로그 — 전달률 집계에서 제외됨
                    </div>
                  </div>
                )}
                {deliveryUnknown24h > 0 && (
                  <div
                    className="card"
                    style={{
                      padding: '14px 16px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '4px',
                    }}
                  >
                    <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                      전달 판정 불가 (최근 24h)
                    </div>
                    <div
                      style={{
                        fontSize: '20px',
                        fontWeight: 700,
                        color: 'var(--status-warning)',
                      }}
                    >
                      {deliveryUnknown24h.toLocaleString('ko-KR')}건
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                      TXG DLR 폴링 한도 초과로 FAILED+DELIVERY_UNKNOWN 종결
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          {/* System Status */}
          <div className="section-header">
            <h3 className="section-title">시스템 상태</h3>
          </div>
          <div className="system-status-row">
            <div className="system-status-item">
              <span className="system-status-label">Infobip API</span>
              <span className="system-status-value">
                <span
                  className="badge-dot"
                  style={{
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    background:
                      stats?.systemStatus?.infobip === 'connected'
                        ? 'var(--status-success)'
                        : 'var(--status-warning)',
                  }}
                />
                {stats?.systemStatus?.infobip === 'connected' ? '정상' : '확인 필요'}
              </span>
            </div>
            <div className="system-status-item">
              <span className="system-status-label">데이터베이스</span>
              <span className="system-status-value">
                <Database size={14} />
                <span
                  className="badge-dot"
                  style={{
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    background:
                      stats?.systemStatus?.database === 'connected'
                        ? 'var(--status-success)'
                        : 'var(--status-warning)',
                  }}
                />
                {stats?.systemStatus?.database === 'connected' ? '정상' : '확인 필요'}
              </span>
            </div>
            <div className="system-status-item">
              <span className="system-status-label">긴급 중지</span>
              <span className="system-status-value">
                <Power size={14} />
                <span
                  className={`badge ${killSwitchActive ? 'badge-danger' : 'badge-success'}`}
                  style={{ padding: '2px 8px' }}
                >
                  {killSwitchActive ? '활성' : '비활성'}
                </span>
              </span>
            </div>
          </div>

          {/* Recent Alerts */}
          <div className="card" style={{ marginTop: '24px' }}>
            <div className="card-header">
              <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <AlertTriangle size={16} style={{ color: 'var(--status-warning)' }} />
                최근 알림
              </h3>
            </div>
            {stats?.recentAlerts.length === 0 ? (
              <div className="table-empty" style={{ padding: '32px' }}>
                <div className="table-empty-text">최근 알림이 없습니다</div>
              </div>
            ) : (
              <div className="data-table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>시간</th>
                      <th>관리자</th>
                      <th>작업</th>
                      <th>결과</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats?.recentAlerts.map((a) => (
                      <tr key={a.id}>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          {new Date(a.createdAt).toLocaleString('ko-KR', {
                            month: '2-digit',
                            day: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </td>
                        <td style={{ color: 'var(--text-main)' }}>{a.adminEmail}</td>
                        <td>{a.action}</td>
                        <td>
                          <span
                            className={`badge ${
                              a.result === 'SUCCESS'
                                ? 'badge-success'
                                : 'badge-danger'
                            }`}
                          >
                            {a.result === 'SUCCESS' ? '성공' : '실패'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
