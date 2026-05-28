'use client';

import { useState } from 'react';
import { Edit3, X, Info } from 'lucide-react';

interface Props {
  userEmail: string | null;
  userName: string | null;
  initialName: string;
  initialCostPerMessage: number;
  initialDailyLimit: number;
  initialMaxCampaign: number;
  /** SUPER_ADMIN 만 단가 변경 가능 */
  canEditCost: boolean;
  loading: boolean;
  onClose: () => void;
  onSubmit: (payload: {
    name?: string;
    costPerMessage?: number;
    dailySendLimit?: number;
    maxCampaignSize?: number;
    reason: string;
  }) => void;
}

const T = {
  surface: 'var(--surface, #FFFFFF)',
  surfaceSoft: 'rgba(148, 163, 184, 0.06)',
  border: 'var(--border, rgba(15, 23, 42, 0.08))',
  borderStrong: 'var(--border-strong, rgba(15, 23, 42, 0.16))',
  textMain: 'var(--text-main, #0F172A)',
  textSecondary: 'var(--text-secondary, #475569)',
  textMuted: 'var(--text-muted, #64748B)',
  primary: 'var(--primary, #FACC15)',
  primaryHover: 'var(--primary-hover, #EAB308)',
  primaryLight: 'var(--primary-light, rgba(250, 204, 21, 0.14))',
  primaryBorder: 'var(--primary-border, rgba(250, 204, 21, 0.55))',
  primaryText: 'var(--primary-text, #1F2937)',
  warning: 'var(--status-warning, #D97706)',
  warningBg: 'var(--status-warning-bg, rgba(217, 119, 6, 0.14))',
  info: 'var(--status-info, #2563EB)',
  infoBg: 'var(--status-info-bg, rgba(37, 99, 235, 0.12))',
  radius: 'var(--radius-md, 8px)',
  radiusLg: 'var(--radius-lg, 12px)',
};

function fieldStyle(): React.CSSProperties {
  return {
    width: '100%',
    padding: '10px 12px',
    borderRadius: T.radius,
    border: `1px solid ${T.borderStrong}`,
    background: T.surface,
    color: T.textMain,
    fontSize: '14px',
    outline: 'none',
    fontFamily: 'inherit',
  };
}

export default function UserEditModal({
  userEmail,
  userName,
  initialName,
  initialCostPerMessage,
  initialDailyLimit,
  initialMaxCampaign,
  canEditCost,
  loading,
  onClose,
  onSubmit,
}: Props) {
  const [name, setName] = useState<string>(initialName ?? '');
  const [costPerMessage, setCostPerMessage] = useState<string>(String(initialCostPerMessage ?? 14));
  const [dailyLimit, setDailyLimit] = useState<string>(String(initialDailyLimit ?? 10000));
  const [maxCampaign, setMaxCampaign] = useState<string>(String(initialMaxCampaign ?? 5000));
  const [reason, setReason] = useState<string>('');

  const cpm = parseFloat(costPerMessage);
  const dl = parseInt(dailyLimit, 10);
  const mc = parseInt(maxCampaign, 10);

  const cpmValid = Number.isFinite(cpm) && cpm > 0;
  const dlValid = Number.isFinite(dl) && dl > 0;
  const mcValid = Number.isFinite(mc) && mc > 0;
  const reasonOk = reason.length >= 5 && reason.length <= 500;
  const disabled = loading || !reasonOk || !cpmValid || !dlValid || !mcValid;

  let disabledReason: string | null = null;
  if (!loading) {
    if (!cpmValid) disabledReason = '건당 단가는 1원 이상 숫자여야 합니다.';
    else if (!dlValid) disabledReason = '일일 발송 한도는 1 이상 정수여야 합니다.';
    else if (!mcValid) disabledReason = '최대 캠페인 크기는 1 이상 정수여야 합니다.';
    else if (reason.length === 0) disabledReason = '사유 5자 이상 입력해야 저장됩니다.';
    else if (reason.length < 5) disabledReason = `사유 ${5 - reason.length}자 더 입력하세요.`;
    else if (reason.length > 500) disabledReason = '사유는 500자를 넘을 수 없습니다.';
  }

  function handleSubmit() {
    if (disabled) return;
    const payload: {
      name?: string;
      costPerMessage?: number;
      dailySendLimit?: number;
      maxCampaignSize?: number;
      reason: string;
    } = { reason };
    if (name && name !== initialName) payload.name = name;
    if (canEditCost && cpmValid && cpm !== Number(initialCostPerMessage)) payload.costPerMessage = cpm;
    if (dlValid && dl !== Number(initialDailyLimit)) payload.dailySendLimit = dl;
    if (mcValid && mc !== Number(initialMaxCampaign)) payload.maxCampaignSize = mc;
    onSubmit(payload);
  }

  const userLabel = userName ?? userEmail ?? '대상 유저';

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(2, 6, 23, 0.72)',
        backdropFilter: 'blur(4px)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="사용자 정보 수정"
        style={{
          width: '100%',
          maxWidth: '520px',
          background: T.surface,
          border: `1px solid ${T.borderStrong}`,
          borderRadius: T.radiusLg,
          boxShadow: '0 24px 60px rgba(2, 6, 23, 0.32)',
          color: T.textMain,
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: `1px solid ${T.border}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: `linear-gradient(180deg, ${T.surfaceSoft} 0%, transparent 100%)`,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span
              style={{
                width: 32,
                height: 32,
                borderRadius: '50%',
                background: T.primaryLight,
                color: T.primary,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: `1px solid ${T.primaryBorder}`,
              }}
            >
              <Edit3 size={16} />
            </span>
            <h3 style={{ margin: 0, fontSize: '17px', fontWeight: 700 }}>사용자 정보 수정</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            disabled={loading}
            style={{
              width: 32,
              height: 32,
              borderRadius: T.radius,
              border: `1px solid ${T.border}`,
              background: 'transparent',
              color: T.textSecondary,
              cursor: loading ? 'not-allowed' : 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Subject */}
        <div
          style={{
            padding: '12px 20px',
            borderBottom: `1px solid ${T.border}`,
            fontSize: '13px',
            color: T.textSecondary,
          }}
        >
          <span style={{ color: T.textMuted }}>유저</span>{' '}
          <strong style={{ color: T.textMain, fontWeight: 600 }}>{userLabel}</strong>
        </div>

        {/* Body */}
        <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <Field label="이름">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={loading}
              autoComplete="off"
              style={fieldStyle()}
            />
          </Field>

          <Field
            label={
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                건당 단가 (원)
                {!canEditCost && (
                  <span
                    style={{
                      fontSize: '11px',
                      padding: '1px 6px',
                      borderRadius: 999,
                      background: T.infoBg,
                      color: T.info,
                      fontWeight: 500,
                    }}
                  >
                    SUPER_ADMIN 전용
                  </span>
                )}
              </span>
            }
          >
            <input
              type="number"
              min={1}
              step={1}
              value={costPerMessage}
              onChange={(e) => setCostPerMessage(e.target.value)}
              placeholder="14"
              disabled={!canEditCost || loading}
              style={{
                ...fieldStyle(),
                borderColor: cpmValid ? T.borderStrong : T.warning,
                background: !canEditCost ? T.surfaceSoft : T.surface,
              }}
            />
            {!canEditCost && (
              <div
                style={{
                  marginTop: 6,
                  padding: '8px 10px',
                  background: T.infoBg,
                  border: `1px solid ${T.info}33`,
                  borderRadius: T.radius,
                  fontSize: '12px',
                  color: T.info,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <Info size={12} /> 건당 단가 변경은 최고 관리자(재인증 필요)만 가능합니다.
              </div>
            )}
          </Field>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <Field label="일일 발송 한도 (건)">
              <input
                type="number"
                min={1}
                step={1}
                value={dailyLimit}
                onChange={(e) => setDailyLimit(e.target.value)}
                disabled={loading}
                style={{ ...fieldStyle(), borderColor: dlValid ? T.borderStrong : T.warning }}
              />
            </Field>
            <Field label="최대 캠페인 크기 (건)">
              <input
                type="number"
                min={1}
                step={1}
                value={maxCampaign}
                onChange={(e) => setMaxCampaign(e.target.value)}
                disabled={loading}
                style={{ ...fieldStyle(), borderColor: mcValid ? T.borderStrong : T.warning }}
              />
            </Field>
          </div>

          <Field label="사유 (5자 이상 500자 이하, 감사 로그에 영구 기록)">
            <textarea
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value.slice(0, 500))}
              placeholder="예) 고객 요청으로 일일 한도 5,000 → 10,000 상향. 티켓 #5678"
              disabled={loading}
              style={{
                ...fieldStyle(),
                resize: 'vertical',
                minHeight: '72px',
                borderColor: reasonOk ? T.primaryBorder : reason.length > 0 ? T.warning : T.borderStrong,
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', fontSize: '11.5px', color: T.textMuted, marginTop: 4 }}>
              {reason.length}/500
            </div>
          </Field>

          {disabled && disabledReason && (
            <div
              role="status"
              style={{
                padding: '10px 12px',
                background: T.warningBg,
                border: `1px solid ${T.warning}33`,
                borderRadius: T.radius,
                fontSize: '12.5px',
                color: T.warning,
                display: 'flex',
                gap: 8,
                alignItems: 'center',
              }}
            >
              <Info size={14} /> {disabledReason}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '14px 20px',
            borderTop: `1px solid ${T.border}`,
            display: 'flex',
            gap: '8px',
            justifyContent: 'flex-end',
            background: T.surfaceSoft,
          }}
        >
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            style={{
              padding: '10px 18px',
              borderRadius: T.radius,
              border: `1px solid ${T.borderStrong}`,
              background: 'transparent',
              color: T.textSecondary,
              cursor: loading ? 'not-allowed' : 'pointer',
              fontSize: '14px',
              fontWeight: 500,
            }}
          >
            취소
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={disabled}
            style={{
              padding: '10px 22px',
              borderRadius: T.radius,
              border: `1px solid ${disabled ? T.borderStrong : T.primary}`,
              background: disabled ? T.surfaceSoft : T.primary,
              color: disabled ? T.textMuted : T.primaryText,
              cursor: disabled ? 'not-allowed' : 'pointer',
              fontSize: '14px',
              fontWeight: 700,
              minWidth: '120px',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              opacity: disabled ? 0.7 : 1,
              transition: 'all 150ms ease',
            }}
          >
            {loading && (
              <span
                style={{
                  width: 14,
                  height: 14,
                  border: '2px solid rgba(31, 41, 55, 0.4)',
                  borderTopColor: T.primaryText,
                  borderRadius: '50%',
                  animation: 'spin 0.8s linear infinite',
                  display: 'inline-block',
                }}
              />
            )}
            저장
          </button>
        </div>
      </div>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}

function Field({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: '12px', color: 'var(--text-muted, #64748B)', marginBottom: 6, fontWeight: 600, letterSpacing: '0.02em' }}>{label}</div>
      {children}
    </div>
  );
}
