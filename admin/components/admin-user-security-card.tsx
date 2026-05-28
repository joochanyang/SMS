'use client';

import { useState } from 'react';
import { Lock } from 'lucide-react';

interface Props {
  canReset: boolean;
  saving: boolean;
  onSubmit: (newPassword: string, confirmPassword: string, reason: string) => void;
}

export default function AdminUserSecurityCard({ canReset, saving, onSubmit }: Props) {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [reason, setReason] = useState('');

  const passwordOk =
    newPassword.length >= 8 && /[a-zA-Z]/.test(newPassword) && /[0-9]/.test(newPassword);
  const matchOk = confirmPassword.length > 0 && confirmPassword === newPassword;
  const reasonOk = reason.length >= 10;
  const canSubmit = canReset && !saving && passwordOk && matchOk && reasonOk;

  return (
    <div className="card" style={{ marginBottom: '16px' }}>
      <div className="card-header">
        <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
          <Lock size={18} /> 보안 / 계정
        </h3>
      </div>
      <div className="card-body">
        <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: 0, marginBottom: '12px' }}>
          유저 비밀번호를 강제로 재설정합니다. 유저는 다음 로그인부터 새 비밀번호를 사용해야 합니다.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <div>
            <label className="label">새 비밀번호 (8자+, 영문+숫자)</label>
            <input
              className="input"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              disabled={!canReset || saving}
              style={{ width: '100%' }}
            />
          </div>
          <div>
            <label className="label">비밀번호 확인</label>
            <input
              className="input"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              disabled={!canReset || saving}
              style={{ width: '100%' }}
            />
          </div>
        </div>
        <div style={{ marginTop: '10px' }}>
          <label className="label">사유 (10자 이상)</label>
          <input
            className="input"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={!canReset || saving}
            placeholder="재설정 사유를 입력하세요..."
            style={{ width: '100%' }}
          />
        </div>
        <div style={{ marginTop: '12px' }}>
          <button
            className="btn btn-primary"
            disabled={!canSubmit}
            onClick={() => onSubmit(newPassword, confirmPassword, reason)}
          >
            {saving && <span className="spinner" />} 비밀번호 재설정
          </button>
        </div>
        {!canReset && (
          <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '10px' }}>
            비밀번호 재설정은 최고 관리자 재인증 후 가능합니다.
          </p>
        )}
      </div>
    </div>
  );
}
