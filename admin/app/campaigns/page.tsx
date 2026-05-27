'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Search, MessageSquare, StopCircle } from 'lucide-react';
import DataTable, { Column } from '@/components/data-table';
import ConfirmModal from '@/components/confirm-modal';
import { hasPermission } from '@/lib/rbac';
import { useAdminInfo } from '@/lib/use-admin-info';

interface CampaignRow {
  id: string;
  userName: string;
  messagePreview: string;
  total: number;
  sent: number;
  failed: number;
  status: string;
  createdAt: string;
}

const statusLabels: Record<string, string> = {
  QUEUED: '대기열',
  SENDING: '발송 중',
  COMPLETED: '완료',
  FAILED: '실패',
  CANCELLED: '중지',
  DRAFT: '대기',
  PENDING: '대기',
};

const statusClasses: Record<string, string> = {
  QUEUED: 'badge-pending',
  SENDING: 'badge-sending',
  COMPLETED: 'badge-success',
  FAILED: 'badge-failed',
  CANCELLED: 'badge-warning',
  DRAFT: 'badge-draft',
  PENDING: 'badge-pending',
};

export default function CampaignsPage() {
  const router = useRouter();
  const admin = useAdminInfo();
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const [stopModal, setStopModal] = useState<{ open: boolean; id: string; name: string }>({
    open: false,
    id: '',
    name: '',
  });
  const [stopLoading, setStopLoading] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: '20',
        ...(search && { search }),
        ...(statusFilter !== 'ALL' && { status: statusFilter }),
      });

      const campRes = await fetch(`/api/campaigns?${params}`);
      if (campRes.status === 401) { router.push('/login'); return; }
      if (campRes.ok) {
        const data = await campRes.json();
        setCampaigns(data.campaigns ?? []);
        setTotalPages(data.totalPages ?? (Math.ceil((data.total ?? 0) / 20) || 1));
      }
    } catch (e) {
      console.error('[campaigns] 조회 실패', e);
    } finally {
      setLoading(false);
    }
  }, [page, search, statusFilter, router]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  async function handleStop() {
    setStopLoading(true);
    try {
      await fetch(`/api/campaigns/${stopModal.id}/stop`, { method: 'POST' });
      setStopModal({ open: false, id: '', name: '' });
      await fetchData();
    } finally {
      setStopLoading(false);
    }
  }

  const canStopCampaigns = admin ? hasPermission(admin.role, 'campaign:stop') : false;

  const columns: Column<CampaignRow>[] = [
    {
      key: 'id',
      label: 'ID',
      width: '80px',
      render: (row) => (
        <span style={{ fontFamily: 'monospace', fontSize: '12px' }}>
          {row.id.slice(0, 8)}
        </span>
      ),
    },
    {
      key: 'userName',
      label: '사용자',
      render: (row) => <span style={{ color: 'var(--text-main)' }}>{row.userName}</span>,
    },
    {
      key: 'messagePreview',
      label: '메시지',
      render: (row) => <span className="message-preview">{row.messagePreview}</span>,
    },
    {
      key: 'progress',
      label: '진행률',
      width: '160px',
      render: (row) => {
        const progress = row.total > 0 ? (row.sent / row.total) * 100 : 0;
        return (
          <div>
            <div className="progress-bar">
              <div
                className={`progress-bar-fill ${
                  row.status === 'FAILED' ? 'danger' : row.status === 'COMPLETED' ? 'success' : 'info'
                }`}
                style={{ width: `${progress}%` }}
              />
            </div>
            <span className="progress-text">
              {row.sent.toLocaleString('ko-KR')} / {row.total.toLocaleString('ko-KR')}
              {row.failed > 0 && (
                <span style={{ color: 'var(--status-danger)', marginLeft: '4px' }}>
                  ({row.failed.toLocaleString('ko-KR')} 실패)
                </span>
              )}
            </span>
          </div>
        );
      },
    },
    {
      key: 'status',
      label: '상태',
      render: (row) => (
        <span className={`badge ${statusClasses[row.status] ?? 'badge-muted'}`}>
          <span className="badge-dot" />
          {statusLabels[row.status] ?? row.status}
        </span>
      ),
    },
    {
      key: 'createdAt',
      label: '생성일',
      render: (row) =>
        new Date(row.createdAt).toLocaleString('ko-KR', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        }),
    },
    {
      key: 'actions',
      label: '',
      width: '80px',
      render: (row) =>
        canStopCampaigns && (row.status === 'SENDING' || row.status === 'QUEUED') ? (
          <button
            className="btn btn-outline-danger btn-xs"
            onClick={(e) => {
              e.stopPropagation();
              setStopModal({ open: true, id: row.id, name: row.userName });
            }}
          >
            <StopCircle size={12} />
            중지
          </button>
        ) : null,
    },
  ];

  return (
    <>
          <div className="filters-bar">
            <div className="filter-search">
              <Search size={16} className="search-icon" />
              <input
                placeholder="사용자 검색..."
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
              />
            </div>
            <select
              className="filter-select"
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setPage(1);
              }}
            >
              <option value="ALL">전체 상태</option>
              <option value="SENDING">발송 중</option>
              <option value="QUEUED">대기열</option>
              <option value="COMPLETED">완료</option>
              <option value="FAILED">실패</option>
              <option value="STOPPED">중지</option>
            </select>
          </div>

          <div className="data-table-wrapper">
            <div className="data-table-header">
              <h3 className="data-table-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <MessageSquare size={16} />
                캠페인 목록
              </h3>
            </div>
            <DataTable
              columns={columns}
              data={campaigns}
              loading={loading}
              onRowClick={(row) => router.push(`/campaigns/${row.id}`)}
              keyExtractor={(row) => row.id}
              emptyMessage="캠페인이 없습니다"
            />
            <div className="data-table-footer">
              <span>페이지 {page} / {totalPages}</span>
              <div className="pagination">
                <button className="pagination-btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                  이전
                </button>
                <button className="pagination-btn" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
                  다음
                </button>
              </div>
            </div>
          </div>

      <ConfirmModal
        isOpen={stopModal.open}
        onClose={() => setStopModal({ open: false, id: '', name: '' })}
        onConfirm={handleStop}
        title="캠페인 중지"
        message={`${stopModal.name}의 캠페인을 중지하시겠습니까? 발송 중인 메시지는 완료되지만 대기 중인 메시지는 발송되지 않습니다.`}
        confirmText="중지"
        danger
        loading={stopLoading}
      />
    </>
  );
}
