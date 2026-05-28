'use client';

import { User as UserIcon, Ban, ShieldOff, ShieldCheck } from 'lucide-react';

interface UserDetail {
  id: string;
  username: string;
  telegramId: string | null;
  name: string | null;
  status: string;
  suspendedAt: string | null;
  suspendReason: string | null;
  createdAt: string;
}

interface Props {
  user: UserDetail;
  canSuspend: boolean;
  canUpdate: boolean;
  onEdit: () => void;
  onSuspend: () => void;
  onUnsuspend: () => void;
  onBan: () => void;
}

const STATUS_KO: Record<string, string> = { ACTIVE: '활성', SUSPENDED: '정지', BANNED: '차단' };
const BADGE_CLASS: Record<string, string> = {
  ACTIVE: 'badge-active',
  SUSPENDED: 'badge-suspended',
  BANNED: 'badge-banned',
};

export default function AdminUserProfileCard({
  user,
  canSuspend,
  canUpdate,
  onEdit,
  onSuspend,
  onUnsuspend,
  onBan,
}: Props) {
  return (
    <div className="card" style={{ marginBottom: '16px' }}>
      <div
        className="card-header"
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
      >
        <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
          <UserIcon size={18} /> 프로필
        </h3>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="btn btn-outline btn-sm" onClick={onEdit} disabled={!canUpdate}>
            수정
          </button>
          {canSuspend && user.status === 'ACTIVE' && (
            <button className="btn btn-outline-danger btn-sm" onClick={onSuspend}>
              <Ban size={14} /> 정지
            </button>
          )}
          {canSuspend && user.status === 'SUSPENDED' && (
            <button className="btn btn-outline btn-sm" onClick={onUnsuspend}>
              <ShieldCheck size={14} /> 해제
            </button>
          )}
          {canSuspend && user.status !== 'BANNED' && (
            <button className="btn btn-outline-danger btn-sm" onClick={onBan}>
              <ShieldOff size={14} /> 차단
            </button>
          )}
        </div>
      </div>
      <div className="card-body">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '14px' }}>
          <div>
            <span className="label">아이디</span>
            <p>{user.username}</p>
          </div>
          <div>
            <span className="label">텔레그램</span>
            <p style={{ color: user.telegramId ? 'var(--text-main)' : 'var(--text-muted)' }}>
              {user.telegramId ?? '—'}
            </p>
          </div>
          <div>
            <span className="label">이름</span>
            <p>{user.name ?? '-'}</p>
          </div>
          <div>
            <span className="label">상태</span>
            <p>
              <span className={`badge ${BADGE_CLASS[user.status] ?? 'badge-muted'}`}>
                <span className="badge-dot" />
                {STATUS_KO[user.status] ?? user.status}
              </span>
            </p>
          </div>
          <div>
            <span className="label">가입일</span>
            <p>{new Date(user.createdAt).toLocaleDateString('ko-KR')}</p>
          </div>
          {user.suspendedAt && (
            <div>
              <span className="label">정지/차단일</span>
              <p>{new Date(user.suspendedAt).toLocaleString('ko-KR')}</p>
            </div>
          )}
          {user.suspendReason && (
            <div style={{ gridColumn: 'span 2' }}>
              <span className="label">사유</span>
              <p>{user.suspendReason}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
