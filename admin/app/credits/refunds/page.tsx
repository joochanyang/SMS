'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Search, RotateCcw, Check, X } from 'lucide-react';
import Sidebar from '@/components/sidebar';
import Header from '@/components/header';
import DataTable, { Column } from '@/components/data-table';
import ConfirmModal from '@/components/confirm-modal';

interface AdminInfo { name: string; email: string; role: string }

interface RefundRow {
  id: string;
  userId: string;
  amount: number;
  reason: string;
  status: string;
  requestedAt: string;
  l1ApprovedById: string | null;
  l2ApprovedById: string | null;
  rejectReason: string | null;
  user: { id: string; email: string; name: string };
}

const statusLabels: Record<string, string> = {
  PENDING: '대기', APPROVED_L1: '1차 승인', EXECUTED: '완료', REJECTED: '거절',
};
const statusClasses: Record<string, string> = {
  PENDING: 'badge-pending', APPROVED_L1: 'badge-sending', EXECUTED: 'badge-success', REJECTED: 'badge-failed',
};

export default function RefundsPage() {
  const router = useRouter();
  const [admin, setAdmin] = useState<AdminInfo | null>(null);
  const [refunds, setRefunds] = useState<RefundRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [killSwitch, setKillSwitch] = useState(false);
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const [actionModal, setActionModal] = useState<{ open: boolean; id: string; action: string; reason: string }>({
    open: false, id: '', action: '', reason: '',
  });
  const [actionLoading, setActionLoading] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page), limit: '20',
        ...(statusFilter !== 'ALL' && { status: statusFilter }),
      });

      const [sessionRes, refundsRes] = await Promise.all([
        fetch('/api/auth/session'),
        fetch(`/api/credits/refunds?${params}`),
      ]);

      if (!sessionRes.ok) { router.push('/login'); return; }

      const sessionData = await sessionRes.json();
      setAdmin(sessionData.admin);
      setKillSwitch(sessionData.killSwitch ?? false);

      if (refundsRes.ok) {
        const data = await refundsRes.json();
        setRefunds(data.refunds ?? []);
        setTotalPages(Math.ceil((data.total ?? 0) / 20) || 1);
      }
    } catch {
      router.push('/login');
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, router]);

  useEffect(() => { fetchData(); }, [fetchData]);

  async function handleAction() {
    setActionLoading(true);
    try {
      const body: any = { action: actionModal.action };
      if (actionModal.action === 'REJECT') body.reason = rejectReason;

      const res = await fetch(`/api/credits/refunds/${actionModal.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setActionModal({ open: false, id: '', action: '', reason: '' });
        setRejectReason('');
        await fetchData();
      }
    } finally {
      setActionLoading(false);
    }
  }

  const columns: Column<RefundRow>[] = [
    { key: 'user', label: '사용자', render: (row) => `${row.user.name} (${row.user.email})` },
    {
      key: 'amount', label: '금액',
      render: (row) => <span style={{ fontWeight: 600 }}>{'\u20A9'}{row.amount.toLocaleString('ko-KR')}</span>,
    },
    { key: 'reason', label: '사유', render: (row) => <span className="message-preview">{row.reason}</span> },
    {
      key: 'status', label: '상태',
      render: (row) => (
        <span className={`badge ${statusClasses[row.status] ?? 'badge-muted'}`}>
          <span className="badge-dot" />{statusLabels[row.status] ?? row.status}
        </span>
      ),
    },
    { key: 'requestedAt', label: '요청일', render: (row) => new Date(row.requestedAt).toLocaleString('ko-KR') },
    {
      key: 'actions', label: '', width: '140px',
      render: (row) => {
        if (row.status === 'PENDING' || row.status === 'APPROVED_L1') {
          return (
            <div style={{ display: 'flex', gap: '4px' }}>
              <button className="btn btn-outline btn-xs" onClick={(e) => { e.stopPropagation(); setActionModal({ open: true, id: row.id, action: 'APPROVE', reason: row.reason }); }}>
                <Check size={12} /> 승인
              </button>
              <button className="btn btn-outline-danger btn-xs" onClick={(e) => { e.stopPropagation(); setActionModal({ open: true, id: row.id, action: 'REJECT', reason: row.reason }); }}>
                <X size={12} /> 거절
              </button>
            </div>
          );
        }
        return null;
      },
    },
  ];

  if (!admin) {
    return <div className="loading-center" style={{ minHeight: '100vh' }}><span className="spinner spinner-lg" /></div>;
  }

  return (
    <div className="admin-layout">
      <Sidebar adminName={admin.name} adminEmail={admin.email} adminRole={admin.role} killSwitchActive={killSwitch} />
      <div className="admin-main">
        <Header title="환불 관리" killSwitchActive={killSwitch} adminName={admin.name} />
        <main className="admin-content">
          <div className="filters-bar">
            <select className="filter-select" value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}>
              <option value="ALL">전체 상태</option>
              <option value="PENDING">대기</option>
              <option value="APPROVED_L1">1차 승인</option>
              <option value="EXECUTED">완료</option>
              <option value="REJECTED">거절</option>
            </select>
          </div>

          <div className="data-table-wrapper">
            <div className="data-table-header">
              <h3 className="data-table-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <RotateCcw size={16} /> 환불 요청
              </h3>
            </div>
            <DataTable columns={columns} data={refunds} loading={loading} keyExtractor={(row) => row.id} emptyMessage="환불 요청이 없습니다" />
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

      <ConfirmModal
        isOpen={actionModal.open}
        onClose={() => { setActionModal({ open: false, id: '', action: '', reason: '' }); setRejectReason(''); }}
        onConfirm={handleAction}
        title={actionModal.action === 'APPROVE' ? '환불 승인' : '환불 거절'}
        message={actionModal.action === 'APPROVE' ? '이 환불 요청을 승인하시겠습니까?' : ''}
        confirmText={actionModal.action === 'APPROVE' ? '승인' : '거절'}
        danger={actionModal.action === 'REJECT'}
        loading={actionLoading}
      >
        {actionModal.action === 'REJECT' && (
          <div style={{ marginBottom: '12px' }}>
            <label className="label">거절 사유 (5자 이상)</label>
            <textarea
              className="input"
              rows={3}
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="거절 사유를 입력하세요..."
              style={{ width: '100%', resize: 'vertical' }}
            />
          </div>
        )}
      </ConfirmModal>
    </div>
  );
}
