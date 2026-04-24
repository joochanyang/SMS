'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { ArrowLeft, MessageSquare, StopCircle, Download } from 'lucide-react';
import Sidebar from '@/components/sidebar';
import Header from '@/components/header';
import DataTable, { Column } from '@/components/data-table';
import ConfirmModal from '@/components/confirm-modal';
import { hasPermission } from '@/lib/rbac';

interface AdminInfo { name: string; email: string; role: string }

interface CampaignDetail {
  id: string;
  name: string | null;
  messageBody: string;
  messageType: string;
  status: string;
  totalRecipients: number;
  processedCount: number;
  deliveredCount: number;
  failedCount: number;
  costPerMessage: number;
  estimatedCost: number;
  createdAt: string;
  updatedAt: string;
  user: { id: string; email: string; name: string; status: string };
}

interface LogEntry {
  id: string;
  targetNumber: string;
  status: string;
  cost: number;
  providerStatus: string | null;
  providerError: string | null;
  networkName: string | null;
  retryCount: number;
  createdAt: string;
}

const statusLabels: Record<string, string> = {
  SENDING: '발송 중', COMPLETED: '완료', FAILED: '실패', CANCELLED: '중지',
  DRAFT: '대기', QUEUED: '대기열', PENDING: '대기',
};

const statusClasses: Record<string, string> = {
  SENDING: 'badge-sending', COMPLETED: 'badge-success', FAILED: 'badge-failed',
  CANCELLED: 'badge-warning', DRAFT: 'badge-draft', QUEUED: 'badge-pending',
};

const logStatusLabels: Record<string, string> = {
  PENDING: '대기', SENT: '발송', DELIVERED: '전달됨', FAILED: '실패', RETRY_PENDING: '재시도 대기',
};

export default function CampaignDetailPage() {
  const router = useRouter();
  const params = useParams();
  const campaignId = params.id as string;

  const [admin, setAdmin] = useState<AdminInfo | null>(null);
  const [campaign, setCampaign] = useState<CampaignDetail | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [stats, setStats] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [killSwitch, setKillSwitch] = useState(false);
  const [stopModal, setStopModal] = useState(false);
  const [stopLoading, setStopLoading] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [sessionRes, campRes] = await Promise.all([
        fetch('/api/auth/session'),
        fetch(`/api/campaigns/${campaignId}`),
      ]);

      if (!sessionRes.ok) { router.push('/login'); return; }

      const sessionData = await sessionRes.json();
      setAdmin(sessionData.admin);
      setKillSwitch(sessionData.killSwitch ?? false);

      if (campRes.ok) {
        const data = await campRes.json();
        setCampaign(data.campaign);
        setLogs(data.logs ?? []);
        setStats(data.stats ?? {});
      }
    } catch {
      router.push('/login');
    } finally {
      setLoading(false);
    }
  }, [campaignId, router]);

  useEffect(() => { fetchData(); }, [fetchData]);

  async function handleStop() {
    setStopLoading(true);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/stop`, { method: 'POST' });
      if (res.ok) {
        setStopModal(false);
        await fetchData();
      }
    } finally {
      setStopLoading(false);
    }
  }

  function handleExportCsv() {
    window.open(`/api/campaigns/${campaignId}/export`, '_blank');
  }

  const logColumns: Column<LogEntry>[] = [
    { key: 'targetNumber', label: '전화번호', render: (row) => <span style={{ fontFamily: 'monospace' }}>{row.targetNumber}</span> },
    {
      key: 'status', label: '상태',
      render: (row) => (
        <span className={`badge ${row.status === 'DELIVERED' ? 'badge-active' : row.status === 'FAILED' ? 'badge-failed' : 'badge-muted'}`}>
          {logStatusLabels[row.status] ?? row.status}
        </span>
      ),
    },
    { key: 'networkName', label: '통신사', render: (row) => row.networkName ?? '-' },
    { key: 'cost', label: '비용', render: (row) => `\u20A9${row.cost.toLocaleString('ko-KR')}` },
    { key: 'retryCount', label: '재시도' },
    { key: 'providerError', label: '오류', render: (row) => row.providerError ?? '-' },
    { key: 'createdAt', label: '일시', render: (row) => new Date(row.createdAt).toLocaleString('ko-KR') },
  ];

  if (!admin || loading) {
    return <div className="loading-center" style={{ minHeight: '100vh' }}><span className="spinner spinner-lg" /></div>;
  }

  const progress = campaign && campaign.totalRecipients > 0
    ? (campaign.deliveredCount / campaign.totalRecipients) * 100
    : 0;
  const canStopCampaign = hasPermission(admin.role, 'campaign:stop');

  return (
    <div className="admin-layout">
      <Sidebar adminName={admin.name} adminEmail={admin.email} adminRole={admin.role} killSwitchActive={killSwitch} />
      <div className="admin-main">
        <Header title="캠페인 상세" killSwitchActive={killSwitch} adminName={admin.name} />
        <main className="admin-content">
          <button className="btn btn-ghost" onClick={() => router.push('/campaigns')} style={{ marginBottom: '16px' }}>
            <ArrowLeft size={16} /> 목록으로
          </button>

          {campaign ? (
            <>
              {/* Campaign info card */}
              <div className="card" style={{ marginBottom: '24px' }}>
                <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
                    <MessageSquare size={18} /> {campaign.name ?? '캠페인'}
                  </h3>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <span className={`badge ${statusClasses[campaign.status] ?? 'badge-muted'}`}>
                      <span className="badge-dot" />
                      {statusLabels[campaign.status] ?? campaign.status}
                    </span>
                    {canStopCampaign && (campaign.status === 'SENDING' || campaign.status === 'QUEUED') && (
                      <button className="btn btn-outline-danger btn-sm" onClick={() => setStopModal(true)}>
                        <StopCircle size={14} /> 긴급 중지
                      </button>
                    )}
                  </div>
                </div>
                <div className="card-body">
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '16px' }}>
                    <div><span className="label">사용자</span><p>{campaign.user.name} ({campaign.user.email})</p></div>
                    <div><span className="label">유형</span><p>{campaign.messageType}</p></div>
                    <div><span className="label">총 수신자</span><p>{campaign.totalRecipients.toLocaleString('ko-KR')}명</p></div>
                    <div><span className="label">전달</span><p style={{ color: 'var(--status-success)' }}>{campaign.deliveredCount.toLocaleString('ko-KR')}건</p></div>
                    <div><span className="label">실패</span><p style={{ color: 'var(--status-danger)' }}>{campaign.failedCount.toLocaleString('ko-KR')}건</p></div>
                    <div><span className="label">예상 비용</span><p>{'\u20A9'}{campaign.estimatedCost.toLocaleString('ko-KR')}</p></div>
                    <div><span className="label">생성일</span><p>{new Date(campaign.createdAt).toLocaleString('ko-KR')}</p></div>
                  </div>

                  {/* Progress bar */}
                  <div style={{ marginTop: '16px' }}>
                    <div className="progress-bar" style={{ height: '8px' }}>
                      <div
                        className={`progress-bar-fill ${campaign.status === 'FAILED' ? 'danger' : campaign.status === 'COMPLETED' ? 'success' : 'info'}`}
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                    <span className="progress-text" style={{ marginTop: '4px' }}>{progress.toFixed(1)}% 완료</span>
                  </div>

                  {/* Message body */}
                  <div style={{ marginTop: '16px' }}>
                    <span className="label">메시지 내용</span>
                    <pre style={{ background: 'var(--bg-secondary)', padding: '12px', borderRadius: '8px', whiteSpace: 'pre-wrap', fontSize: '13px', marginTop: '4px' }}>
                      {campaign.messageBody}
                    </pre>
                  </div>

                  {/* Status breakdown */}
                  {Object.keys(stats).length > 0 && (
                    <div style={{ marginTop: '16px' }}>
                      <span className="label">상태별 통계</span>
                      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginTop: '4px' }}>
                        {Object.entries(stats).map(([status, count]) => (
                          <div key={status} className="card" style={{ padding: '8px 16px', minWidth: '100px', textAlign: 'center' }}>
                            <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{logStatusLabels[status] ?? status}</div>
                            <div style={{ fontSize: '18px', fontWeight: 700 }}>{count.toLocaleString('ko-KR')}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Message logs */}
              <div className="data-table-wrapper">
                <div className="data-table-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h3 className="data-table-title">발송 로그 (최근 100건)</h3>
                  <button className="btn btn-outline" onClick={handleExportCsv} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Download size={14} /> 엑셀 다운로드
                  </button>
                </div>
                <DataTable
                  columns={logColumns}
                  data={logs}
                  loading={false}
                  keyExtractor={(row) => row.id}
                  emptyMessage="발송 로그가 없습니다"
                />
              </div>
            </>
          ) : (
            <div className="card"><div className="card-body"><p>캠페인을 찾을 수 없습니다.</p></div></div>
          )}
        </main>
      </div>

      <ConfirmModal
        isOpen={stopModal}
        onClose={() => setStopModal(false)}
        onConfirm={handleStop}
        title="캠페인 긴급 중지"
        message="이 캠페인을 즉시 중지하시겠습니까? 대기 중인 메시지는 발송되지 않습니다."
        confirmText="중지"
        danger
        loading={stopLoading}
      />
    </div>
  );
}
