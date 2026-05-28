'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { ArrowLeft, CreditCard, MessageSquare } from 'lucide-react';
import toast from 'react-hot-toast';
import DataTable, { Column } from '@/components/data-table';
import ConfirmModal from '@/components/confirm-modal';
import SudoModal from '@/components/sudo-modal';
import AdminUserProfileCard from '@/components/admin-user-profile-card';
import AdminUserRoutingCard from '@/components/admin-user-routing-card';
import AdminUserBillingCard from '@/components/admin-user-billing-card';
import AdminUserSecurityCard from '@/components/admin-user-security-card';
import CreditAdjustModal, { type CreditAdjustType, type CreditAdjustUnit } from '@/components/credit-adjust-modal';
import UserEditModal from '@/components/user-edit-modal';
import { hasPermission } from '@/lib/rbac';
import { randomUUID } from '@/lib/uuid';

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
  const [globalActiveProvider, setGlobalActiveProvider] = useState<string>('infobip');

  // Modals
  const [suspendModal, setSuspendModal] = useState<{ open: boolean; action: string }>({ open: false, action: '' });
  const [suspendReason, setSuspendReason] = useState('');
  const [suspendLoading, setSuspendLoading] = useState(false);

  const [creditModal, setCreditModal] = useState(false);
  const [creditType, setCreditType] = useState<CreditAdjustType>('ADMIN_ADD');
  const [creditLoading, setCreditLoading] = useState(false);
  // 같은 idempotency key 는 모달이 열려 있는 동안 재시도 시 보존된다 (서버 중복 방지).
  const [creditRequestKey, setCreditRequestKey] = useState<string | null>(null);
  // sudo 재인증 후 자동 재시도를 위해 마지막 페이로드를 보관.
  const [pendingCreditPayload, setPendingCreditPayload] = useState<{
    unit: CreditAdjustUnit;
    type: CreditAdjustType;
    count?: number;
    amount?: number;
    reason: string;
  } | null>(null);
  const [showSudoModal, setShowSudoModal] = useState(false);
  const [sudoRetryAction, setSudoRetryAction] = useState<'credit' | 'edit' | null>(null);

  const [editModal, setEditModal] = useState(false);
  const [editLoading, setEditLoading] = useState(false);
  // sudo 재인증 후 자동 재시도용
  const [pendingEditPayload, setPendingEditPayload] = useState<{
    name?: string;
    costPerMessage?: number;
    dailySendLimit?: number;
    maxCampaignSize?: number;
    reason: string;
  } | null>(null);

  const [routingSaving, setRoutingSaving] = useState(false);
  const [pwSaving, setPwSaving] = useState(false);
  // 비밀번호 재설정 성공 후 카드 내부 폼 상태(평문 비번 포함)를 즉시 unmount 하기 위해 key 를 bump 한다.
  const [securityFormKey, setSecurityFormKey] = useState(0);

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

  async function submitCreditAdjust(payload: {
    unit: CreditAdjustUnit;
    type: CreditAdjustType;
    count?: number;
    amount?: number;
    reason: string;
  }) {
    setPendingCreditPayload(payload);
    setCreditLoading(true);
    try {
      const idempotencyKey = creditRequestKey ?? randomUUID();
      setCreditRequestKey(idempotencyKey);
      const body: Record<string, unknown> = {
        unit: payload.unit,
        type: payload.type,
        reason: payload.reason,
        idempotencyKey,
      };
      if (payload.unit === 'COUNT') {
        body.count = payload.count;
      } else {
        body.amount = payload.amount;
      }
      const res = await fetch(`/api/users/${userId}/credits`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        toast.success(
          payload.type === 'ADMIN_ADD' ? '크레딧을 충전했습니다.' : '크레딧을 차감했습니다.',
        );
        setCreditModal(false);
        setCreditRequestKey(null);
        setPendingCreditPayload(null);
        await fetchData();
      } else if (res.status === 403 && data.requireSudo) {
        setSudoRetryAction('credit');
        setShowSudoModal(true);
      } else {
        toast.error(data.error || '처리에 실패했습니다.');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '네트워크 오류로 실패했습니다.');
    } finally {
      setCreditLoading(false);
    }
  }

  async function submitEdit(payload: {
    name?: string;
    costPerMessage?: number;
    dailySendLimit?: number;
    maxCampaignSize?: number;
    reason: string;
  }) {
    if (!user) return;
    setPendingEditPayload(payload);
    setEditLoading(true);
    try {
      const res = await fetch(`/api/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        toast.success('사용자 정보를 수정했습니다.');
        setEditModal(false);
        setPendingEditPayload(null);
        await fetchData();
      } else if (res.status === 403 && data.requireSudo) {
        setSudoRetryAction('edit');
        setShowSudoModal(true);
      } else {
        toast.error(data.error || '수정에 실패했습니다.');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '네트워크 오류로 실패했습니다.');
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
        // 카드를 새 key 로 강제 unmount → 입력된 평문 비밀번호 state 즉시 폐기.
        setSecurityFormKey((k) => k + 1);
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
    <>
      {/* Sidebar/Header 는 AdminShell(공통 layout) 이 렌더하므로 이 페이지는 본문만 그린다. */}
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
                onEdit={() => setEditModal(true)}
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
                onEditCost={() => setEditModal(true)}
              />

              <AdminUserSecurityCard
                key={securityFormKey}
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
      {creditModal && user && (
        <CreditAdjustModal
          type={creditType}
          userEmail={user.email}
          userName={user.name}
          currentCredits={Number(user.credits)}
          costPerMessage={Number(user.costPerMessage)}
          loading={creditLoading}
          onClose={() => {
            if (creditLoading) return;
            setCreditModal(false);
            setCreditRequestKey(null);
            setPendingCreditPayload(null);
          }}
          onSubmit={submitCreditAdjust}
        />
      )}

      {/* Edit Modal */}
      {editModal && user && (
        <UserEditModal
          userEmail={user.email}
          userName={user.name}
          initialName={user.name ?? ''}
          initialCostPerMessage={Number(user.costPerMessage ?? 14)}
          initialDailyLimit={user.dailySendLimit}
          initialMaxCampaign={user.maxCampaignSize}
          canEditCost={canChangeCostPerMessage}
          loading={editLoading}
          onClose={() => {
            if (editLoading) return;
            setEditModal(false);
            setPendingEditPayload(null);
          }}
          onSubmit={submitEdit}
        />
      )}

      <SudoModal
        isOpen={showSudoModal}
        onClose={() => {
          setShowSudoModal(false);
          setSudoRetryAction(null);
        }}
        onSuccess={async () => {
          setShowSudoModal(false);
          if (sudoRetryAction === 'credit' && pendingCreditPayload) {
            await submitCreditAdjust(pendingCreditPayload);
          } else if (sudoRetryAction === 'edit' && pendingEditPayload) {
            await submitEdit(pendingEditPayload);
          }
          setSudoRetryAction(null);
        }}
      />
    </>
  );
}
