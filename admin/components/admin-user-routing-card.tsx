'use client';

import { useState } from 'react';
import { Route, Undo2 } from 'lucide-react';

interface Props {
  currentSmsProvider: string | null;
  globalDefault: string; // 활성 라인 (예: 'infobip')
  canChange: boolean;    // SUPER_ADMIN 만 true
  saving: boolean;
  onChange: (next: string | null, reason: string) => void;
}

const PROVIDER_LABEL: Record<string, string> = {
  infobip: 'Infobip',
  smsto: 'SMS.to',
  txg: 'TXG-TEL',
};

export default function AdminUserRoutingCard({
  currentSmsProvider,
  globalDefault,
  canChange,
  saving,
  onChange,
}: Props) {
  const [selected, setSelected] = useState<string>(currentSmsProvider ?? '');
  const [reason, setReason] = useState('');
  const activeLine = currentSmsProvider ?? globalDefault;
  const isOverridden = currentSmsProvider !== null;

  function submit(nextValue: string | null) {
    if (reason.length < 5) return;
    onChange(nextValue, reason);
  }

  return (
    <div className="card" style={{ marginBottom: '16px' }}>
      <div className="card-header">
        <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
          <Route size={18} /> 발송 라인 라우팅
        </h3>
      </div>
      <div className="card-body">
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            marginBottom: '14px',
            flexWrap: 'wrap',
          }}
        >
          <span className="badge badge-muted">
            전역 기본 ({PROVIDER_LABEL[globalDefault] ?? globalDefault})
          </span>
          <span style={{ color: 'var(--text-muted)' }}>→</span>
          <span
            className={`badge ${isOverridden ? 'badge-active' : 'badge-muted'}`}
            style={{ opacity: isOverridden ? 1 : 0.5 }}
          >
            유저 오버라이드 {isOverridden ? `(${PROVIDER_LABEL[currentSmsProvider!] ?? currentSmsProvider})` : '없음'}
          </span>
          <span style={{ color: 'var(--text-muted)' }}>→</span>
          <span className="badge badge-active">
            현재 라인: <strong>{PROVIDER_LABEL[activeLine] ?? activeLine}</strong>
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', alignItems: 'end' }}>
          <div>
            <label className="label">라인 변경</label>
            <select
              className="input"
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              disabled={!canChange || saving}
              style={{ width: '100%' }}
            >
              <option value="">전역 기본 사용</option>
              <option value="infobip">Infobip</option>
              <option value="smsto">SMS.to</option>
              <option value="txg">TXG-TEL</option>
            </select>
          </div>
          <div>
            <label className="label">사유 (5자 이상)</label>
            <input
              className="input"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={!canChange || saving}
              placeholder="변경 사유..."
              style={{ width: '100%' }}
            />
          </div>
        </div>

        <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
          <button
            className="btn btn-primary btn-sm"
            disabled={
              !canChange ||
              saving ||
              reason.length < 5 ||
              selected === (currentSmsProvider ?? '')
            }
            onClick={() => submit(selected === '' ? null : selected)}
          >
            {saving && <span className="spinner" />} 변경 적용
          </button>
          {isOverridden && (
            <button
              className="btn btn-ghost btn-sm"
              disabled={!canChange || saving || reason.length < 5}
              onClick={() => submit(null)}
            >
              <Undo2 size={14} /> 전역 기본으로 되돌리기
            </button>
          )}
        </div>

        {!canChange && (
          <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '10px' }}>
            발송 라인 변경은 최고 관리자 재인증 후 가능합니다.
          </p>
        )}
      </div>
    </div>
  );
}
