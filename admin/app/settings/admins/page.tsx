'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Shield, Plus, Trash2, Edit2 } from 'lucide-react';
import Sidebar from '@/components/sidebar';
import Header from '@/components/header';
import DataTable, { Column } from '@/components/data-table';
import ConfirmModal from '@/components/confirm-modal';

interface AdminInfo { name: string; email: string; role: string }

interface AdminRow {
  id: string;
  email: string;
  name: string;
  role: string;
  status: string;
  mfaEnabled: boolean;
  dailyCreditLimit: number;
  lastLoginAt: string | null;
  createdAt: string;
}

const roleLabels: Record<string, string> = {
  SUPER_ADMIN: '최고 관리자', ADMIN: '관리자', SUPPORT: '지원', VIEWER: '뷰어',
};
const roleClasses: Record<string, string> = {
  SUPER_ADMIN: 'badge-active', ADMIN: 'badge-sending', SUPPORT: 'badge-pending', VIEWER: 'badge-muted',
};
const statusLabels: Record<string, string> = { ACTIVE: '활성', LOCKED: '잠김', DISABLED: '비활성' };

export default function AdminUsersPage() {
  const router = useRouter();
  const [admin, setAdmin] = useState<AdminInfo | null>(null);
  const [admins, setAdmins] = useState<AdminRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [killSwitch, setKillSwitch] = useState(false);

  // Create modal
  const [createModal, setCreateModal] = useState(false);
  const [createEmail, setCreateEmail] = useState('');
  const [createName, setCreateName] = useState('');
  const [createPassword, setCreatePassword] = useState('');
  const [createRole, setCreateRole] = useState('VIEWER');
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState('');

  // Edit modal
  const [editModal, setEditModal] = useState<{ open: boolean; admin: AdminRow | null }>({ open: false, admin: null });
  const [editRole, setEditRole] = useState('');
  const [editStatus, setEditStatus] = useState('');
  const [editCreditLimit, setEditCreditLimit] = useState('');
  const [editReason, setEditReason] = useState('');
  const [editLoading, setEditLoading] = useState(false);

  // Delete modal
  const [deleteModal, setDeleteModal] = useState<{ open: boolean; id: string; name: string }>({ open: false, id: '', name: '' });
  const [deleteLoading, setDeleteLoading] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [sessionRes, adminsRes] = await Promise.all([
        fetch('/api/auth/session'),
        fetch('/api/settings/admins'),
      ]);

      if (!sessionRes.ok) { router.push('/login'); return; }

      const sessionData = await sessionRes.json();
      setAdmin(sessionData.admin);
      setKillSwitch(sessionData.killSwitch ?? false);

      if (adminsRes.ok) {
        const data = await adminsRes.json();
        setAdmins(data.admins ?? []);
      }
    } catch {
      router.push('/login');
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => { fetchData(); }, [fetchData]);

  async function handleCreate() {
    setCreateLoading(true);
    setCreateError('');
    try {
      const res = await fetch('/api/settings/admins', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: createEmail, name: createName, password: createPassword, role: createRole }),
      });
      if (res.ok) {
        setCreateModal(false);
        setCreateEmail(''); setCreateName(''); setCreatePassword(''); setCreateRole('VIEWER');
        await fetchData();
      } else {
        const data = await res.json();
        setCreateError(data.error ?? '생성에 실패했습니다.');
      }
    } finally {
      setCreateLoading(false);
    }
  }

  async function handleEdit() {
    if (!editModal.admin || editReason.length < 5) return;
    setEditLoading(true);
    try {
      const body: any = { reason: editReason };
      if (editRole) body.role = editRole;
      if (editStatus) body.status = editStatus;
      if (editCreditLimit) body.dailyCreditLimit = parseFloat(editCreditLimit);

      const res = await fetch(`/api/settings/admins/${editModal.admin.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setEditModal({ open: false, admin: null });
        await fetchData();
      }
    } finally {
      setEditLoading(false);
    }
  }

  async function handleDelete() {
    setDeleteLoading(true);
    try {
      const res = await fetch(`/api/settings/admins/${deleteModal.id}`, { method: 'DELETE' });
      if (res.ok) {
        setDeleteModal({ open: false, id: '', name: '' });
        await fetchData();
      }
    } finally {
      setDeleteLoading(false);
    }
  }

  const columns: Column<AdminRow>[] = [
    { key: 'email', label: '이메일' },
    { key: 'name', label: '이름' },
    {
      key: 'role', label: '역할',
      render: (row) => <span className={`badge ${roleClasses[row.role] ?? 'badge-muted'}`}>{roleLabels[row.role] ?? row.role}</span>,
    },
    {
      key: 'status', label: '상태',
      render: (row) => <span className={`badge ${row.status === 'ACTIVE' ? 'badge-active' : 'badge-suspended'}`}>{statusLabels[row.status] ?? row.status}</span>,
    },
    { key: 'mfaEnabled', label: 'MFA', render: (row) => row.mfaEnabled ? 'ON' : 'OFF' },
    { key: 'lastLoginAt', label: '마지막 로그인', render: (row) => row.lastLoginAt ? new Date(row.lastLoginAt).toLocaleString('ko-KR') : '-' },
    {
      key: 'actions', label: '', width: '100px',
      render: (row) => {
        if (row.role === 'SUPER_ADMIN') return null;
        return (
          <div style={{ display: 'flex', gap: '4px' }}>
            <button className="btn btn-ghost btn-xs" onClick={(e) => {
              e.stopPropagation();
              setEditRole(row.role);
              setEditStatus(row.status);
              setEditCreditLimit(String(row.dailyCreditLimit));
              setEditReason('');
              setEditModal({ open: true, admin: row });
            }}>
              <Edit2 size={12} />
            </button>
            <button className="btn btn-outline-danger btn-xs" onClick={(e) => {
              e.stopPropagation();
              setDeleteModal({ open: true, id: row.id, name: row.name });
            }}>
              <Trash2 size={12} />
            </button>
          </div>
        );
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
        <Header title="관리자 계정" killSwitchActive={killSwitch} adminName={admin.name} />
        <main className="admin-content">
          <div className="filters-bar" style={{ justifyContent: 'flex-end' }}>
            <button className="btn btn-primary btn-sm" onClick={() => setCreateModal(true)}>
              <Plus size={14} /> 관리자 추가
            </button>
          </div>

          <div className="data-table-wrapper">
            <div className="data-table-header">
              <h3 className="data-table-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Shield size={16} /> 관리자 목록
              </h3>
            </div>
            <DataTable columns={columns} data={admins} loading={loading} keyExtractor={(row) => row.id} emptyMessage="관리자가 없습니다" />
          </div>
        </main>
      </div>

      {/* Create Admin Modal */}
      {createModal && (
        <div className="modal-overlay" onClick={() => setCreateModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '440px' }}>
            <h3 style={{ marginBottom: '16px' }}>관리자 추가</h3>
            {createError && <p style={{ color: 'var(--status-danger)', marginBottom: '12px' }}>{createError}</p>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label className="label">이메일</label>
                <input className="input" value={createEmail} onChange={(e) => setCreateEmail(e.target.value)} style={{ width: '100%' }} />
              </div>
              <div>
                <label className="label">이름</label>
                <input className="input" value={createName} onChange={(e) => setCreateName(e.target.value)} style={{ width: '100%' }} />
              </div>
              <div>
                <label className="label">비밀번호 (16자 이상)</label>
                <input className="input" type="password" value={createPassword} onChange={(e) => setCreatePassword(e.target.value)} style={{ width: '100%' }} />
              </div>
              <div>
                <label className="label">역할</label>
                <select className="filter-select" value={createRole} onChange={(e) => setCreateRole(e.target.value)} style={{ width: '100%' }}>
                  <option value="VIEWER">뷰어</option>
                  <option value="SUPPORT">지원</option>
                  <option value="ADMIN">관리자</option>
                </select>
              </div>
              <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                <button className="btn btn-ghost" onClick={() => setCreateModal(false)}>취소</button>
                <button className="btn btn-primary" disabled={createLoading || !createEmail || !createName || createPassword.length < 16} onClick={handleCreate}>
                  {createLoading && <span className="spinner" />} 생성
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit Admin Modal */}
      {editModal.open && editModal.admin && (
        <div className="modal-overlay" onClick={() => setEditModal({ open: false, admin: null })}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '440px' }}>
            <h3 style={{ marginBottom: '16px' }}>관리자 수정: {editModal.admin.name}</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label className="label">역할</label>
                <select className="filter-select" value={editRole} onChange={(e) => setEditRole(e.target.value)} style={{ width: '100%' }}>
                  <option value="VIEWER">뷰어</option>
                  <option value="SUPPORT">지원</option>
                  <option value="ADMIN">관리자</option>
                </select>
              </div>
              <div>
                <label className="label">상태</label>
                <select className="filter-select" value={editStatus} onChange={(e) => setEditStatus(e.target.value)} style={{ width: '100%' }}>
                  <option value="ACTIVE">활성</option>
                  <option value="LOCKED">잠김</option>
                  <option value="DISABLED">비활성</option>
                </select>
              </div>
              <div>
                <label className="label">일일 크레딧 한도</label>
                <input className="input" type="number" value={editCreditLimit} onChange={(e) => setEditCreditLimit(e.target.value)} style={{ width: '100%' }} />
              </div>
              <div>
                <label className="label">사유 (5자 이상)</label>
                <textarea className="input" rows={2} value={editReason} onChange={(e) => setEditReason(e.target.value)} placeholder="변경 사유..." style={{ width: '100%', resize: 'vertical' }} />
              </div>
              <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                <button className="btn btn-ghost" onClick={() => setEditModal({ open: false, admin: null })}>취소</button>
                <button className="btn btn-primary" disabled={editLoading || editReason.length < 5} onClick={handleEdit}>
                  {editLoading && <span className="spinner" />} 저장
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Admin Modal */}
      <ConfirmModal
        isOpen={deleteModal.open}
        onClose={() => setDeleteModal({ open: false, id: '', name: '' })}
        onConfirm={handleDelete}
        title="관리자 삭제"
        message={`${deleteModal.name} 관리자를 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`}
        confirmText="삭제"
        danger
        loading={deleteLoading}
      />
    </div>
  );
}
