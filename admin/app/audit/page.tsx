'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Search, History, ChevronDown, ChevronUp } from 'lucide-react';
import Sidebar from '@/components/sidebar';
import Header from '@/components/header';
import DataTable, { Column } from '@/components/data-table';

interface AdminInfo { name: string; email: string; role: string }

interface AuditRow {
  id: string;
  timestamp: string;
  adminEmail: string;
  action: string;
  targetType: string;
  targetId: string | null;
  previousValue: any;
  newValue: any;
  reason: string;
  ipAddress: string;
  result: string;
}

const actionLabels: Record<string, string> = {
  USER_CREATE: '유저 생성', USER_UPDATE: '유저 수정', USER_SUSPEND: '유저 정지',
  USER_UNSUSPEND: '정지 해제', USER_BAN: '유저 차단', CREDIT_ADJUST: '크레딧 조정',
  CREDIT_ADJUST_FAILED: '크레딧 조정 실패', CAMPAIGN_STOP: '캠페인 중지',
  BLACKLIST_ADD: '블랙리스트 추가', BLACKLIST_REMOVE: '블랙리스트 제거',
  TEMPLATE_APPROVE: '템플릿 승인', TEMPLATE_REJECT: '템플릿 거절',
  SETTING_UPDATE: '설정 변경', ADMIN_CREATE: '관리자 생성',
  ADMIN_UPDATE: '관리자 수정', ADMIN_DELETE: '관리자 삭제',
  KILLSWITCH_TOGGLE: '킬스위치 변경', AUDIT_QUERY: '감사 로그 조회',
  LOGIN: '로그인', LOGOUT: '로그아웃',
};

export default function AuditPage() {
  const router = useRouter();
  const [admin, setAdmin] = useState<AdminInfo | null>(null);
  const [logs, setLogs] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [killSwitch, setKillSwitch] = useState(false);
  const [actionFilter, setActionFilter] = useState('');
  const [targetTypeFilter, setTargetTypeFilter] = useState('');
  const [resultFilter, setResultFilter] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page), limit: '30',
        ...(actionFilter && { action: actionFilter }),
        ...(targetTypeFilter && { targetType: targetTypeFilter }),
        ...(resultFilter && { result: resultFilter }),
      });

      const [sessionRes, auditRes] = await Promise.all([
        fetch('/api/auth/session'),
        fetch(`/api/audit?${params}`),
      ]);

      if (!sessionRes.ok) { router.push('/login'); return; }

      const sessionData = await sessionRes.json();
      setAdmin(sessionData.admin);
      setKillSwitch(sessionData.killSwitch ?? false);

      if (auditRes.ok) {
        const data = await auditRes.json();
        setLogs(data.logs ?? []);
        setTotalPages(Math.ceil((data.total ?? 0) / 30) || 1);
      }
    } catch {
      router.push('/login');
    } finally {
      setLoading(false);
    }
  }, [page, actionFilter, targetTypeFilter, resultFilter, router]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const columns: Column<AuditRow>[] = [
    {
      key: 'timestamp', label: '시간', width: '160px',
      render: (row) => new Date(row.timestamp).toLocaleString('ko-KR'),
    },
    { key: 'adminEmail', label: '관리자' },
    {
      key: 'action', label: '액션',
      render: (row) => (
        <span className={`badge ${row.result === 'FAILURE' ? 'badge-failed' : 'badge-muted'}`}>
          {actionLabels[row.action] ?? row.action}
        </span>
      ),
    },
    { key: 'targetType', label: '대상', render: (row) => `${row.targetType}${row.targetId ? ` (${row.targetId.slice(0, 8)}...)` : ''}` },
    { key: 'reason', label: '사유', render: (row) => <span className="message-preview">{row.reason}</span> },
    { key: 'ipAddress', label: 'IP', width: '120px', render: (row) => <span style={{ fontFamily: 'monospace', fontSize: '12px' }}>{row.ipAddress}</span> },
    {
      key: 'result', label: '결과', width: '70px',
      render: (row) => (
        <span className={`badge ${row.result === 'SUCCESS' ? 'badge-active' : 'badge-failed'}`}>
          {row.result === 'SUCCESS' ? '성공' : '실패'}
        </span>
      ),
    },
    {
      key: 'detail', label: '', width: '40px',
      render: (row) => (
        <button className="btn btn-ghost btn-xs" onClick={(e) => { e.stopPropagation(); setExpandedId(expandedId === row.id ? null : row.id); }}>
          {expandedId === row.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      ),
    },
  ];

  if (!admin) {
    return <div className="loading-center" style={{ minHeight: '100vh' }}><span className="spinner spinner-lg" /></div>;
  }

  return (
    <div className="admin-layout">
      <Sidebar adminName={admin.name} adminEmail={admin.email} adminRole={admin.role} killSwitchActive={killSwitch} />
      <div className="admin-main">
        <Header title="감사 로그" killSwitchActive={killSwitch} adminName={admin.name} />
        <main className="admin-content">
          <div className="filters-bar">
            <select className="filter-select" value={actionFilter} onChange={(e) => { setActionFilter(e.target.value); setPage(1); }}>
              <option value="">전체 액션</option>
              {Object.entries(actionLabels).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
            <select className="filter-select" value={targetTypeFilter} onChange={(e) => { setTargetTypeFilter(e.target.value); setPage(1); }}>
              <option value="">전체 대상</option>
              <option value="User">User</option>
              <option value="SmsCampaign">SmsCampaign</option>
              <option value="AdminUser">AdminUser</option>
              <option value="SystemSetting">SystemSetting</option>
              <option value="Blacklist">Blacklist</option>
              <option value="MessageTemplate">MessageTemplate</option>
            </select>
            <select className="filter-select" value={resultFilter} onChange={(e) => { setResultFilter(e.target.value); setPage(1); }}>
              <option value="">전체 결과</option>
              <option value="SUCCESS">성공</option>
              <option value="FAILURE">실패</option>
            </select>
          </div>

          <div className="data-table-wrapper">
            <div className="data-table-header">
              <h3 className="data-table-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <History size={16} /> 감사 로그
              </h3>
            </div>
            <DataTable
              columns={columns}
              data={logs}
              loading={loading}
              keyExtractor={(row) => row.id}
              emptyMessage="감사 로그가 없습니다"
            />

            {/* Expanded detail panel */}
            {expandedId && (() => {
              const row = logs.find((l) => l.id === expandedId);
              if (!row) return null;
              return (
                <div style={{ padding: '16px', background: 'var(--bg-secondary)', borderRadius: '8px', margin: '0 0 16px 0' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                    {row.previousValue && (
                      <div>
                        <span className="label">이전 값</span>
                        <pre style={{ fontSize: '12px', fontFamily: 'monospace', whiteSpace: 'pre-wrap', marginTop: '4px' }}>
                          {JSON.stringify(row.previousValue, null, 2)}
                        </pre>
                      </div>
                    )}
                    {row.newValue && (
                      <div>
                        <span className="label">새 값</span>
                        <pre style={{ fontSize: '12px', fontFamily: 'monospace', whiteSpace: 'pre-wrap', marginTop: '4px' }}>
                          {JSON.stringify(row.newValue, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}
            <div className="data-table-footer">
              <span>페이지 {page} / {totalPages}</span>
              <div className="pagination">
                <button className="pagination-btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>이전</button>
                <button className="pagination-btn" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>다음</button>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
