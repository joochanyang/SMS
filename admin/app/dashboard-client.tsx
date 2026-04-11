'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Send,
  CheckCircle,
  XCircle,
  DollarSign,
  Activity,
  Database,
  Power,
  AlertTriangle,
} from 'lucide-react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import Sidebar from '@/components/sidebar';
import Header from '@/components/header';
import StatCard from '@/components/stat-card';

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
        const statsData = await statsRes.json();
        setStats(statsData);
      } else {
        // Use placeholder data if API not yet implemented
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
        });
      }
    } catch {
      router.push('/login');
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
              <ResponsiveContainer>
                <LineChart data={stats?.tpsData ?? []}>
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
                            <span className="badge badge-sending">
                              <span className="badge-dot" />
                              발송 중
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
                      stats?.systemStatus.infobip === 'ok'
                        ? 'var(--status-success)'
                        : 'var(--status-warning)',
                  }}
                />
                {stats?.systemStatus.infobip === 'ok' ? '정상' : '확인 필요'}
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
                      stats?.systemStatus.database === 'ok'
                        ? 'var(--status-success)'
                        : 'var(--status-warning)',
                  }}
                />
                {stats?.systemStatus.database === 'ok' ? '정상' : '확인 필요'}
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
