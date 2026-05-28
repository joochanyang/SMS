'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { ArrowLeft, CreditCard, MessageSquare } from 'lucide-react';
import toast from 'react-hot-toast';
import Sidebar from '@/components/sidebar';
import Header from '@/components/header';
import DataTable, { Column } from '@/components/data-table';
import ConfirmModal from '@/components/confirm-modal';
import SudoModal from '@/components/sudo-modal';
import AdminUserProfileCard from '@/components/admin-user-profile-card';
import AdminUserRoutingCard from '@/components/admin-user-routing-card';
import AdminUserBillingCard from '@/components/admin-user-billing-card';
import AdminUserSecurityCard from '@/components/admin-user-security-card';
import { hasPermission } from '@/lib/rbac';

interface AdminInfo { name: string; email: string; role: string }

interface UserDetail {
  id: string;
  email: string;
  name: string;
  credits: number;
  costPerMessage: number;
  smsProvider: string | null;
  status: string;
  dailySendLimit: number;
  maxCampaignSize: number;
  suspendedAt: string | null;
  suspendReason: string | null;
  createdAt: string;
  updatedAt: string;
}

interface LedgerEntry {
  id: string;
  type: string;
  amount: number;
  balanceAfter: number;
  description: string;
  createdAt: string;
}

interface CampaignEntry {
  id: string;
  name: string;
  status: string;
  totalRecipients: number;
  deliveredCount: number;
  failedCount: number;
  estimatedCost: number;
  createdAt: string;
}

const ledgerTypeMap: Record<string, string> = {
  ADMIN_ADD: '관리자 충전', ADMIN_DEDUCT: '관리자 차감', CORRECTION: '보정',
  BONUS: '보너스', REFUND: '환불', SMS_COST: 'SMS 비용', DEPOSIT: '입금',
};

export default function UserDetailPage() {
  const router = useRouter();
  const params = useParams();
  const userId = params.id as string;

  const [admin, setAdmin] = useState<AdminInfo | null>(null);
  const [user, setUser] = useState<UserDetail | null>(null);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [killSwitch, setKillSwitch] = useState(false);
  const [globalActiveProvider, setGlobalActiveProvider] = useState<string>('infobip');

  // Modals
  const [suspendModal, setSuspendModal] = useState<{ open: boolean; action: string }>({ open: false, action: '' });
  const [suspendReason, setSuspendReason] = useState('');
  const [suspendLoading, setSuspendLoading] = useState(false);

  const [creditModal, setCreditModal] = useState(false);
  const [creditAmount, setCreditAmount] = useState('');
  const [creditType, setCreditType] = useState<'ADMIN_ADD' | 'ADMIN_DEDUCT'>('ADMIN_ADD');
  const [creditUnit, setCreditUnit] = useState<'KRW' | 'COUNT'>('KRW');
  const [creditReason, setCreditReason] = useState('');
  const [creditRequestKey, setCreditRequestKey] = useState<string | null>(null);
  const [creditLoading, setCreditLoading] = useState(false);
  const [showSudoModal, setShowSudoModal] = useState(false);
  const [sudoRetryAction, setSudoRetryAction] = useState<'credit' | 'edit' | null>(null);

  const [editModal, setEditModal] = useState(false);
  const [editName, setEditName] = useState('');
  const [editCostPerMessage, setEditCostPerMessage] = useState('');
  const [editDailyLimit, setEditDailyLimit] = useState('');
  const [editMaxCampaign, setEditMaxCampaign] = useState('');
  const [editReason, setEditReason] = useState('');
  const [editLoading, setEditLoading] = useState(false);

  const [routingSaving, setRoutingSaving] = useState(false);
  const [pwSaving, setPwSaving] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [sessionRes, userRes, provRes] = await Promise.all([
        fetch('/api/auth/session'),
        fetch(`/api/users/${userId}`),
        fetch('/api/sms-providers'),
      ]);

      if (!sessionRes.ok) { router.push('/login'); return; }

      const sessionData = await sessionRes.json();
      setAdmin(sessionData.admin);
      setKillSwitch(sessionData.killSwitch ?? false);

      if (userRes.ok) {
        const data = await userRes.json();
        setUser(data.user);
        setLedger(data.recentLedger ?? []);
        setCampaigns(data.recentCampaigns ?? []);
      }

      if (provRes.ok) {
        const pd = await provRes.json();
        if (typeof pd.activeProvider === 'string') {
          setGlobalActiveProvider(pd.activeProvider);
        }
      }
    } catch {
      router.push('/login');
    } finally {
      setLoading(false);
    }
  }, [userId, router]);

  useEffect(() => { fetchData(); }, [fetchData]);

  async function handleSuspend() {
    if (!suspendReason || suspendReason.length < 10) return;
    setSuspendLoading(true);
    try {
      const res = await fetch(`/api/users/${userId}/suspend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: suspendModal.action, reason: suspendReason }),
      });
      if (res.ok) {
        setSuspendModal({ open: false, action: '' });
        setSuspendReason('');
        await fetchData();
      }
    } finally {
      setSuspendLoading(false);
    }
  }

  async function handleCreditAdjust() {
    const value = parseFloat(creditAmount);
    if (isNaN(value) || value <= 0 || creditReason.length < 10) return;
    if (creditUnit === 'COUNT' && !Number.isInteger(value)) return;
    setCreditLoading(true);
    try {
      const idempotencyKey = creditRequestKey ?? crypto.randomUUID();
      setCreditRequestKey(idempotencyKey);
      const body: Record<string, unknown> = {
        unit: creditUnit,
        type: creditType,
        reason: creditReason,
        idempotencyKey,
      };
      if (creditUnit === 'COUNT') {
        body.count = value;
      } else {
        body.amount = creditType === 'ADMIN_DEDUCT' ? -value : value;
      }
      const res = await fetch(`/api/users/${userId}/credits`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        toast.success(creditType === 'ADMIN_ADD' ? '크레딧을 충전했습니다.' : '크레딧을 차감했습니다.');
        setCreditModal(false);
        setCreditAmount('');
        setCreditReason('');
        setCreditRequestKey(null);
        await fetchData();
      } else {
        const data = await res.json().catch(() => ({}));
        if (res.status === 403 && data.requireSudo) {
          setSudoRetryAction('credit');
          setShowSudoModal(true);
        } else {
          toast.error(data.error || '처리에 실패했습니다.');
        }
      }
    } finally {
      setCreditLoading(false);
    }
  }

  async function handleEdit() {
    if (editReason.length < 5 || !user) return;
    setEditLoading(true);
    try {
      const canChangeCostPerMessage = admin?.role === 'SUPER_ADMIN';
      const body: {
        reason: string;
        name?: string;
        costPerMessage?: number;
        dailySendLimit?: number;
        maxCampaignSize?: number;
      } = { reason: editReason };
      if (editName) body.name = editName;
      if (canChangeCostPerMessage && editCostPerMessage) {
        const nextCostPerMessage = parseFloat(editCostPerMessage);
        if (nextCostPerMessage !== Number(user.costPerMessage)) {
          body.costPerMessage = nextCostPerMessage;
        }
      }
      if (editDailyLimit) body.dailySendLimit = parseInt(editDailyLimit);
      if (editMaxCampaign) body.maxCampaignSize = parseInt(editMaxCampaign);

      const res = await fetch(`/api/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        toast.success('사용자 정보를 수정했습니다.');
        setEditModal(false);
        await fetchData();
      } else {
        const data = await res.json().catch(() => ({}));
        if (res.status === 403 && data.requireSudo) {
          setSudoRetryAction('edit');
          setShowSudoModal(true);
        } else {
          toast.error(data.error || '수정에 실패했습니다.');
        }
      }
    } finally {
      setEditLoading(false);
    }
  }

  async function handleSmsProviderChange(next: string | null, reason: string) {
    setRoutingSaving(true);
    try {
      const res = await fetch(`/api/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ smsProvider: next, reason }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        toast.success('발송 라인을 변경했습니다.');
        await fetchData();
      } else if (res.status === 403 && data.requireSudo) {
        setSudoRetryAction(null);
        setShowSudoModal(true);
        toast.error('재인증 후 다시 시도하세요.');
      } else {
        toast.error(data.error || '변경에 실패했습니다.');
      }
    } finally {
      setRoutingSaving(false);
    }
  }

  async function handlePasswordReset(newPassword: string, confirmPassword: string, reason: string) {
    if (!window.confirm('정말로 이 유저의 비밀번호를 재설정합니까? 유저는 다음 로그인 시 새 비밀번호를 사용해야 합니다.')) {
      return;
    }
    setPwSaving(true);
    try {
      const res = await fetch(`/api/users/${userId}/password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPassword, confirmPassword, reason }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        toast.success('비밀번호를 재설정했습니다.');
      } else if (res.status === 403 && data.requireSudo) {
        setSudoRetryAction(null);
        setShowSudoModal(true);
        toast.error('재인증 후 다시 시도하세요.');
      } else {
        toast.error(data.error || '재설정에 실패했습니다.');
      }
    } finally {
      setPwSaving(false);
    }
  }

  const ledgerColumns: Column<LedgerEntry>[] = [
    {
      key: 'type', label: '유형',
      render: (row) => <span className={`badge ${row.amount >= 0 ? 'badge-active' : 'badge-suspended'}`}>{ledgerTypeMap[row.type] ?? row.type}</span>,
    },
    {
      key: 'amount', label: '금액',
      render: (row) => (
        <span style={{ color: row.amount >= 0 ? 'var(--status-success)' : 'var(--status-danger)', fontWeight: 600 }}>
          {row.amount >= 0 ? '+' : ''}{'₩'}{row.amount.toLocaleString('ko-KR')}
        </span>
      ),
    },
    {
      key: 'balanceAfter', label: '잔액',
      render: (row) => <span>{'₩'}{row.balanceAfter.toLocaleString('ko-KR')}</span>,
    },
    { key: 'description', label: '설명' },
    {
      key: 'createdAt', label: '일시',
      render: (row) => new Date(row.createdAt).toLocaleString('ko-KR'),
    },
  ];

  const campaignColumns: Column<CampaignEntry>[] = [
    { key: 'name', label: '캠페인명', render: (row) => row.name ?? '-' },
    {
      key: 'status', label: '상태',
      render: (row) => <span className="badge badge-muted">{row.status}</span>,
    },
    {
      key: 'progress', label: '진행',
      render: (row) => `${row.deliveredCount}/${row.totalRecipients} (실패: ${row.failedCount})`,
    },
    {
      key: 'estimatedCost', label: '비용',
      render: (row) => `₩${row.estimatedCost.toLocaleString('ko-KR')}`,
    },
    {
      key: 'createdAt', label: '생성일',
      render: (row) => new Date(row.createdAt).toLocaleDateString('ko-KR'),
    },
  ];

  if (!admin || loading) {
    return (
      <div className="loading-center" style={{ minHeight: '100vh' }}>
        <span className="spinner spinner-lg" />
      </div>
    );
  }

  const canUpdateUser = hasPermission(admin.role, 'user:update');
  const canChangeCostPerMessage = admin.role === 'SUPER_ADMIN';
  const canSuspendUser = hasPermission(admin.role, 'user:suspend');
  const canAdjustCredits = hasPermission(admin.role, 'credit:adjust_small') || hasPermission(admin.role, 'credit:adjust_large');

  return (
    <div className="admin-layout">
      <Sidebar adminName={admin.name} adminEmail={admin.email} adminRole={admin.role} killSwitchActive={killSwitch} />
      <div className="admin-main">
        <Header title="사용자 상세" killSwitchActive={killSwitch} adminName={admin.name} />
        <main className="admin-content">
          {/* Back button */}
          <button className="btn btn-ghost" onClick={() => router.push('/users')} style={{ marginBottom: '16px' }}>
            <ArrowLeft size={16} /> 목록으로
          </button>

          {user ? (
            <>
              <AdminUserProfileCard
                user={{
                  id: user.id,
                  email: user.email,
                  name: user.name,
                  status: user.status,
                  suspendedAt: user.suspendedAt,
                  suspendReason: user.suspendReason,
                  createdAt: user.createdAt,
                }}
                canSuspend={canSuspendUser}
                canUpdate={canUpdateUser}
                onEdit={() => {
                  setEditName(user.name ?? '');
                  setEditCostPerMessage(String(Number(user.costPerMessage ?? 14)));
                  setEditDailyLimit(String(user.dailySendLimit));
                  setEditMaxCampaign(String(user.maxCampaignSize));
                  setEditReason('');
                  setEditModal(true);
                }}
                onSuspend={() => setSuspendModal({ open: true, action: 'SUSPEND' })}
                onUnsuspend={() => setSuspendModal({ open: true, action: 'UNSUSPEND' })}
                onBan={() => setSuspendModal({ open: true, action: 'BAN' })}
              />

              <AdminUserRoutingCard
                currentSmsProvider={user.smsProvider}
                globalDefault={globalActiveProvider}
                canChange={canChangeCostPerMessage}
                saving={routingSaving}
                onChange={handleSmsProviderChange}
              />

              <AdminUserBillingCard
                credits={user.credits}
                costPerMessage={Number(user.costPerMessage)}
                dailySendLimit={user.dailySendLimit}
                maxCampaignSize={user.maxCampaignSize}
                canAdjustCredits={canAdjustCredits}
                canEditCost={canChangeCostPerMessage}
                onTopUp={() => { setCreditType('ADMIN_ADD'); setCreditModal(true); }}
                onDeduct={() => { setCreditType('ADMIN_DEDUCT'); setCreditModal(true); }}
                onEditCost={() => {
                  setEditName(user.name ?? '');
                  setEditCostPerMessage(String(Number(user.costPerMessage ?? 14)));
                  setEditDailyLimit(String(user.dailySendLimit));
                  setEditMaxCampaign(String(user.maxCampaignSize));
                  setEditReason('');
                  setEditModal(true);
                }}
              />

              <AdminUserSecurityCard
                canReset={admin?.role === 'SUPER_ADMIN'}
                saving={pwSaving}
                onSubmit={handlePasswordReset}
              />

              {/* Credit history */}
              <div className="data-table-wrapper" style={{ marginBottom: '24px' }}>
                <div className="data-table-header">
                  <h3 className="data-table-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <CreditCard size={16} /> 크레딧 내역 (최근 20건)
                  </h3>
                </div>
                <DataTable
                  columns={ledgerColumns}
                  data={ledger}
                  loading={false}
                  keyExtractor={(row) => row.id}
                  emptyMessage="크레딧 내역이 없습니다"
                />
              </div>

              {/* Campaign history */}
              <div className="data-table-wrapper">
                <div className="data-table-header">
                  <h3 className="data-table-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <MessageSquare size={16} /> 캠페인 내역 (최근 10건)
                  </h3>
                </div>
                <DataTable
                  columns={campaignColumns}
                  data={campaigns}
                  loading={false}
                  onRowClick={(row) => router.push(`/campaigns/${row.id}`)}
                  keyExtractor={(row) => row.id}
                  emptyMessage="캠페인 내역이 없습니다"
                />
              </div>
            </>
          ) : (
            <div className="card"><div className="card-body"><p>유저를 찾을 수 없습니다.</p></div></div>
          )}
        </main>
      </div>

      {/* Suspend/Ban Modal */}
      <ConfirmModal
        isOpen={suspendModal.open}
        onClose={() => { setSuspendModal({ open: false, action: '' }); setSuspendReason(''); }}
        onConfirm={handleSuspend}
        title={suspendModal.action === 'SUSPEND' ? '유저 정지' : suspendModal.action === 'UNSUSPEND' ? '정지 해제' : '유저 차단'}
        message=""
        confirmText={suspendModal.action === 'UNSUSPEND' ? '해제' : '확인'}
        danger={suspendModal.action !== 'UNSUSPEND'}
        loading={suspendLoading}
      >
        <div style={{ marginBottom: '12px' }}>
          <label className="label">사유 (10자 이상)</label>
          <textarea
            className="input"
            rows={3}
            value={suspendReason}
            onChange={(e) => setSuspendReason(e.target.value)}
            placeholder="사유를 입력하세요..."
            style={{ width: '100%', resize: 'vertical' }}
          />
        </div>
      </ConfirmModal>

      {/* Credit Adjustment Modal */}
      {creditModal && (
        <div className="modal-overlay" onClick={() => { setCreditModal(false); setCreditRequestKey(null); }}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '440px' }}>
            <h3 style={{ marginBottom: '16px' }}>
              {creditType === 'ADMIN_ADD'
                ? (creditUnit === 'COUNT' ? '건수 지급' : '크레딧 충전')
                : (creditUnit === 'COUNT' ? '건수 차감' : '크레딧 차감')}
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label className="label">단위</label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    type="button"
                    className={`btn btn-sm ${creditUnit === 'KRW' ? 'btn-primary' : 'btn-ghost'}`}
                    onClick={() => setCreditUnit('KRW')}
                    style={{ flex: 1 }}
                  >
                    금액 (원)
                  </button>
                  <button
                    type="button"
                    className={`btn btn-sm ${creditUnit === 'COUNT' ? 'btn-primary' : 'btn-ghost'}`}
                    onClick={() => setCreditUnit('COUNT')}
                    style={{ flex: 1 }}
                  >
                    건수 (건)
                  </button>
                </div>
              </div>
              <div>
                <label className="label">{creditUnit === 'COUNT' ? '건수 (건)' : '금액 (원)'}</label>
                <input
                  className="input"
                  type="number"
                  min="1"
                  step={creditUnit === 'COUNT' ? 1 : 'any'}
                  value={creditAmount}
                  onChange={(e) => setCreditAmount(e.target.value)}
                  placeholder={creditUnit === 'COUNT' ? '건수를 입력하세요' : '금액을 입력하세요'}
                  style={{ width: '100%' }}
                />
                {creditUnit === 'COUNT' && user && Number(creditAmount) > 0 && (
                  <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '6px' }}>
                    💡 {Number(creditAmount).toLocaleString('ko-KR')}건 × {Number(user.costPerMessage).toLocaleString('ko-KR')}원 = {(Number(creditAmount) * Number(user.costPerMessage)).toLocaleString('ko-KR')}원
                    {creditType === 'ADMIN_ADD' ? ' 적립' : ' 차감'}
                  </p>
                )}
              </div>
              <div>
                <label className="label">사유 (10자 이상)</label>
                <textarea
                  className="input"
                  rows={3}
                  value={creditReason}
                  onChange={(e) => setCreditReason(e.target.value)}
                  placeholder="사유를 입력하세요..."
                  style={{ width: '100%', resize: 'vertical' }}
                />
              </div>
              <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                <button className="btn btn-ghost" onClick={() => { setCreditModal(false); setCreditRequestKey(null); }}>취소</button>
                <button
                  className={`btn ${creditType === 'ADMIN_ADD' ? 'btn-primary' : 'btn-danger'}`}
                  disabled={creditLoading || !creditAmount || creditReason.length < 10}
                  onClick={handleCreditAdjust}
                >
                  {creditLoading && <span className="spinner" />}
                  {creditType === 'ADMIN_ADD' ? '충전' : '차감'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {editModal && (
        <div className="modal-overlay" onClick={() => setEditModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '440px' }}>
            <h3 style={{ marginBottom: '16px' }}>사용자 정보 수정</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label className="label">이름</label>
                <input className="input" value={editName} onChange={(e) => setEditName(e.target.value)} style={{ width: '100%' }} />
              </div>
              <div>
                <label className="label">건당 단가 (원)</label>
                <input
                  className="input"
                  type="number"
                  min="1"
                  step="1"
                  value={editCostPerMessage}
                  onChange={(e) => setEditCostPerMessage(e.target.value)}
                  placeholder="14"
                  disabled={!canChangeCostPerMessage}
                  style={{ width: '100%' }}
                />
                {!canChangeCostPerMessage && (
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '6px' }}>
                    건당 단가 변경은 최고 관리자 재인증 후 가능합니다.
                  </p>
                )}
              </div>
              <div>
                <label className="label">일일 발송 한도</label>
                <input className="input" type="number" value={editDailyLimit} onChange={(e) => setEditDailyLimit(e.target.value)} style={{ width: '100%' }} />
              </div>
              <div>
                <label className="label">최대 캠페인 크기</label>
                <input className="input" type="number" value={editMaxCampaign} onChange={(e) => setEditMaxCampaign(e.target.value)} style={{ width: '100%' }} />
              </div>
              <div>
                <label className="label">사유 (5자 이상)</label>
                <textarea className="input" rows={2} value={editReason} onChange={(e) => setEditReason(e.target.value)} placeholder="변경 사유..." style={{ width: '100%', resize: 'vertical' }} />
              </div>
              <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                <button className="btn btn-ghost" onClick={() => setEditModal(false)}>취소</button>
                <button className="btn btn-primary" disabled={editLoading || editReason.length < 5} onClick={handleEdit}>
                  {editLoading && <span className="spinner" />} 저장
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <SudoModal
        isOpen={showSudoModal}
        onClose={() => {
          setShowSudoModal(false);
          setSudoRetryAction(null);
        }}
        onSuccess={async () => {
          setShowSudoModal(false);
          if (sudoRetryAction === 'credit') {
            await handleCreditAdjust();
          } else if (sudoRetryAction === 'edit') {
            await handleEdit();
          }
          setSudoRetryAction(null);
        }}
      />
    </div>
  );
}
