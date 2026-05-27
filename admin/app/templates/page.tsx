'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { FileText, Check, X, Eye } from 'lucide-react';
import DataTable, { Column } from '@/components/data-table';
import ConfirmModal from '@/components/confirm-modal';
import { hasPermission } from '@/lib/rbac';
import { useAdminInfo } from '@/lib/use-admin-info';

interface TemplateRow {
  id: string;
  name: string;
  content: string;
  type: string;
  status: string;
  variables: string[];
  createdAt: string;
  user: { id: string; email: string; name: string };
}

const statusLabels: Record<string, string> = {
  PENDING: '대기', APPROVED: '승인', REJECTED: '거절',
};
const statusClasses: Record<string, string> = {
  PENDING: 'badge-pending', APPROVED: 'badge-success', REJECTED: 'badge-failed',
};

export default function TemplatesPage() {
  const router = useRouter();
  const admin = useAdminInfo();
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('PENDING');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  // Review modal
  const [reviewModal, setReviewModal] = useState<{ open: boolean; id: string; action: string; template: TemplateRow | null }>({
    open: false, id: '', action: '', template: null,
  });
  const [rejectReason, setRejectReason] = useState('');
  const [reviewLoading, setReviewLoading] = useState(false);

  // Preview modal
  const [previewTemplate, setPreviewTemplate] = useState<TemplateRow | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page), limit: '20',
        ...(statusFilter !== 'ALL' && { status: statusFilter }),
      });

      const tplRes = await fetch(`/api/templates?${params}`);
      if (tplRes.status === 401) { router.push('/login'); return; }
      if (tplRes.ok) {
        const data = await tplRes.json();
        setTemplates(data.templates ?? []);
        setTotalPages(Math.ceil((data.total ?? 0) / 20) || 1);
      }
    } catch (e) {
      console.error('[templates] 조회 실패', e);
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, router]);

  useEffect(() => { fetchData(); }, [fetchData]);

  async function handleReview() {
    setReviewLoading(true);
    try {
      const body: { action: string; rejectReason?: string } = { action: reviewModal.action };
      if (reviewModal.action === 'REJECT') body.rejectReason = rejectReason;

      const res = await fetch(`/api/templates/${reviewModal.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setReviewModal({ open: false, id: '', action: '', template: null });
        setRejectReason('');
        await fetchData();
      }
    } finally {
      setReviewLoading(false);
    }
  }

  const canReviewTemplates = admin ? hasPermission(admin.role, 'template:review') : false;

  const columns: Column<TemplateRow>[] = [
    { key: 'name', label: '템플릿명', render: (row) => <span style={{ fontWeight: 500 }}>{row.name}</span> },
    { key: 'type', label: '유형', render: (row) => <span className="badge badge-muted">{row.type}</span> },
    { key: 'content', label: '내용', render: (row) => <span className="message-preview">{row.content.slice(0, 60)}...</span> },
    { key: 'user', label: '작성자', render: (row) => row.user?.name ?? '-' },
    {
      key: 'status', label: '상태',
      render: (row) => (
        <span className={`badge ${statusClasses[row.status] ?? 'badge-muted'}`}>
          <span className="badge-dot" />{statusLabels[row.status] ?? row.status}
        </span>
      ),
    },
    { key: 'createdAt', label: '생성일', render: (row) => new Date(row.createdAt).toLocaleDateString('ko-KR') },
    {
      key: 'actions', label: '', width: '160px',
      render: (row) => (
        <div style={{ display: 'flex', gap: '4px' }}>
          <button className="btn btn-ghost btn-xs" onClick={(e) => { e.stopPropagation(); setPreviewTemplate(row); }}>
            <Eye size={12} />
          </button>
          {canReviewTemplates && row.status === 'PENDING' && (
            <>
              <button className="btn btn-outline btn-xs" onClick={(e) => { e.stopPropagation(); setReviewModal({ open: true, id: row.id, action: 'APPROVE', template: row }); }}>
                <Check size={12} /> 승인
              </button>
              <button className="btn btn-outline-danger btn-xs" onClick={(e) => { e.stopPropagation(); setReviewModal({ open: true, id: row.id, action: 'REJECT', template: row }); }}>
                <X size={12} /> 거절
              </button>
            </>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
          <div className="filters-bar">
            <select className="filter-select" value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}>
              <option value="ALL">전체</option>
              <option value="PENDING">대기</option>
              <option value="APPROVED">승인</option>
              <option value="REJECTED">거절</option>
            </select>
          </div>

          <div className="data-table-wrapper">
            <div className="data-table-header">
              <h3 className="data-table-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <FileText size={16} /> 메시지 템플릿
              </h3>
            </div>
            <DataTable columns={columns} data={templates} loading={loading} keyExtractor={(row) => row.id} emptyMessage="템플릿이 없습니다" />
            <div className="data-table-footer">
              <span>페이지 {page} / {totalPages}</span>
              <div className="pagination">
                <button className="pagination-btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>이전</button>
                <button className="pagination-btn" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>다음</button>
              </div>
            </div>
          </div>

      {/* Preview Modal */}
      {previewTemplate && (
        <div className="modal-overlay" onClick={() => setPreviewTemplate(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '520px' }}>
            <h3 style={{ marginBottom: '16px' }}>{previewTemplate.name}</h3>
            <div style={{ marginBottom: '12px' }}>
              <span className="label">유형</span>
              <p>{previewTemplate.type}</p>
            </div>
            {previewTemplate.variables.length > 0 && (
              <div style={{ marginBottom: '12px' }}>
                <span className="label">변수</span>
                <p>{previewTemplate.variables.join(', ')}</p>
              </div>
            )}
            <div>
              <span className="label">내용</span>
              <pre style={{ background: 'var(--bg-secondary)', padding: '12px', borderRadius: '8px', whiteSpace: 'pre-wrap', fontSize: '13px', marginTop: '4px' }}>
                {previewTemplate.content}
              </pre>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '16px' }}>
              <button className="btn btn-ghost" onClick={() => setPreviewTemplate(null)}>닫기</button>
            </div>
          </div>
        </div>
      )}

      {/* Review Modal */}
      <ConfirmModal
        isOpen={reviewModal.open && canReviewTemplates}
        onClose={() => { setReviewModal({ open: false, id: '', action: '', template: null }); setRejectReason(''); }}
        onConfirm={handleReview}
        title={reviewModal.action === 'APPROVE' ? '템플릿 승인' : '템플릿 거절'}
        message={reviewModal.action === 'APPROVE' ? '이 템플릿을 승인하시겠습니까?' : ''}
        confirmText={reviewModal.action === 'APPROVE' ? '승인' : '거절'}
        danger={reviewModal.action === 'REJECT'}
        loading={reviewLoading}
      >
        {reviewModal.action === 'REJECT' && (
          <div style={{ marginBottom: '12px' }}>
            <label className="label">거절 사유 (5자 이상)</label>
            <textarea className="input" rows={3} value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="거절 사유를 입력하세요..." style={{ width: '100%', resize: 'vertical' }} />
          </div>
        )}
      </ConfirmModal>
    </>
  );
}
