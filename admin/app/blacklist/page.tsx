'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { ShieldOff, Plus, Trash2 } from 'lucide-react';
import Sidebar from '@/components/sidebar';
import Header from '@/components/header';
import DataTable, { Column } from '@/components/data-table';
import ConfirmModal from '@/components/confirm-modal';

interface AdminInfo { name: string; email: string; role: string }

interface BlacklistEntry {
  id: string;
  phoneNumber: string;
  type: string;
  reason: string | null;
  isGlobal: boolean;
  createdAt: string;
}

export default function BlacklistPage() {
  const router = useRouter();
  const [admin, setAdmin] = useState<AdminInfo | null>(null);
  const [entries, setEntries] = useState<BlacklistEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [killSwitch, setKillSwitch] = useState(false);
  const [typeFilter, setTypeFilter] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  // Add modal
  const [addModal, setAddModal] = useState(false);
  const [addPhone, setAddPhone] = useState('');
  const [addType, setAddType] = useState('SPAM');
  const [addReason, setAddReason] = useState('');
  const [addLoading, setAddLoading] = useState(false);

  // Remove modal
  const [removeModal, setRemoveModal] = useState<{ open: boolean; id: string; phone: string }>({ open: false, id: '', phone: '' });
  const [removeReason, setRemoveReason] = useState('');
  const [removeLoading, setRemoveLoading] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page), limit: '20',
        ...(typeFilter && { type: typeFilter }),
      });

      const [sessionRes, blRes] = await Promise.all([
        fetch('/api/auth/session'),
        fetch(`/api/blacklist?${params}`),
      ]);

      if (!sessionRes.ok) { router.push('/login'); return; }

      const sessionData = await sessionRes.json();
      setAdmin(sessionData.admin);
      setKillSwitch(sessionData.killSwitch ?? false);

      if (blRes.ok) {
        const data = await blRes.json();
        setEntries(data.entries ?? []);
        setTotalPages(Math.ceil((data.total ?? 0) / 20) || 1);
      }
    } catch {
      router.push('/login');
    } finally {
      setLoading(false);
    }
  }, [page, typeFilter, router]);

  useEffect(() => { fetchData(); }, [fetchData]);

  async function handleAdd() {
    if (!addPhone || addReason.length < 5) return;
    setAddLoading(true);
    try {
      const res = await fetch('/api/blacklist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber: addPhone, type: addType, reason: addReason }),
      });
      if (res.ok) {
        setAddModal(false);
        setAddPhone('');
        setAddReason('');
        await fetchData();
      }
    } finally {
      setAddLoading(false);
    }
  }

  async function handleRemove() {
    if (removeReason.length < 5) return;
    setRemoveLoading(true);
    try {
      const res = await fetch('/api/blacklist', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: removeModal.id, reason: removeReason }),
      });
      if (res.ok) {
        setRemoveModal({ open: false, id: '', phone: '' });
        setRemoveReason('');
        await fetchData();
      }
    } finally {
      setRemoveLoading(false);
    }
  }

  const columns: Column<BlacklistEntry>[] = [
    { key: 'phoneNumber', label: '전화번호', render: (row) => <span style={{ fontFamily: 'monospace' }}>{row.phoneNumber}</span> },
    { key: 'type', label: '유형', render: (row) => <span className="badge badge-muted">{row.type}</span> },
    { key: 'reason', label: '사유', render: (row) => row.reason ?? '-' },
    { key: 'isGlobal', label: '범위', render: (row) => row.isGlobal ? '전체' : '개별' },
    { key: 'createdAt', label: '등록일', render: (row) => new Date(row.createdAt).toLocaleDateString('ko-KR') },
    {
      key: 'actions', label: '', width: '60px',
      render: (row) => (
        <button className="btn btn-outline-danger btn-xs" onClick={(e) => {
          e.stopPropagation();
          setRemoveModal({ open: true, id: row.id, phone: row.phoneNumber });
        }}>
          <Trash2 size={12} />
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
        <Header title="블랙리스트 관리" killSwitchActive={killSwitch} adminName={admin.name} />
        <main className="admin-content">
          <div className="filters-bar">
            <select className="filter-select" value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}>
              <option value="">전체 유형</option>
              <option value="SPAM">스팸</option>
              <option value="COMPLAINT">민원</option>
              <option value="INVALID">무효</option>
              <option value="DNC">수신거부</option>
            </select>
            <button className="btn btn-primary btn-sm" onClick={() => setAddModal(true)}>
              <Plus size={14} /> 번호 추가
            </button>
          </div>

          <div className="data-table-wrapper">
            <div className="data-table-header">
              <h3 className="data-table-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <ShieldOff size={16} /> 블랙리스트
              </h3>
            </div>
            <DataTable columns={columns} data={entries} loading={loading} keyExtractor={(row) => row.id} emptyMessage="블랙리스트가 비어있습니다" />
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

      {/* Add Modal */}
      {addModal && (
        <div className="modal-overlay" onClick={() => setAddModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '440px' }}>
            <h3 style={{ marginBottom: '16px' }}>블랙리스트 추가</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label className="label">전화번호</label>
                <input className="input" value={addPhone} onChange={(e) => setAddPhone(e.target.value)} placeholder="01012345678" style={{ width: '100%' }} />
              </div>
              <div>
                <label className="label">유형</label>
                <select className="filter-select" value={addType} onChange={(e) => setAddType(e.target.value)} style={{ width: '100%' }}>
                  <option value="SPAM">스팸</option>
                  <option value="COMPLAINT">민원</option>
                  <option value="INVALID">무효</option>
                  <option value="DNC">수신거부</option>
                </select>
              </div>
              <div>
                <label className="label">사유 (5자 이상)</label>
                <textarea className="input" rows={2} value={addReason} onChange={(e) => setAddReason(e.target.value)} placeholder="사유를 입력하세요..." style={{ width: '100%', resize: 'vertical' }} />
              </div>
              <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                <button className="btn btn-ghost" onClick={() => setAddModal(false)}>취소</button>
                <button className="btn btn-primary" disabled={addLoading || !addPhone || addReason.length < 5} onClick={handleAdd}>
                  {addLoading && <span className="spinner" />} 추가
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Remove Modal */}
      <ConfirmModal
        isOpen={removeModal.open}
        onClose={() => { setRemoveModal({ open: false, id: '', phone: '' }); setRemoveReason(''); }}
        onConfirm={handleRemove}
        title="블랙리스트 제거"
        message={`${removeModal.phone} 번호를 블랙리스트에서 제거하시겠습니까?`}
        confirmText="제거"
        danger
        loading={removeLoading}
      >
        <div style={{ marginBottom: '12px' }}>
          <label className="label">사유 (5자 이상)</label>
          <textarea className="input" rows={2} value={removeReason} onChange={(e) => setRemoveReason(e.target.value)} placeholder="제거 사유..." style={{ width: '100%', resize: 'vertical' }} />
        </div>
      </ConfirmModal>
    </div>
  );
}
