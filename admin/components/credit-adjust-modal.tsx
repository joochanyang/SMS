'use client';

import { useMemo, useState } from 'react';
import { Plus, Minus, X, AlertTriangle, Info } from 'lucide-react';

export type CreditAdjustType = 'ADMIN_ADD' | 'ADMIN_DEDUCT';
// 모달은 항상 건수(COUNT) 단위로만 지급/차감한다. KRW 모드는 의도적으로 제거.
export type CreditAdjustUnit = 'COUNT';

interface Props {
  type: CreditAdjustType;
  userEmail: string | null;
  userName: string | null;
  currentCredits: number;
  costPerMessage: number;
  /** 관리자 일일 지급 한도(원) — 0/미지정이면 한도 검사 생략 */
  dailyCreditLimit?: number;
  /** 오늘 이미 지급한 누적(원) — 한도 대비 잔여 계산용 */
  usedToday?: number;
  loading: boolean;
  onClose: () => void;
  onSubmit: (payload: {
    unit: 'COUNT';
    type: CreditAdjustType;
    count: number;
    reason: string;
  }) => void;
}

const COUNT_PRESETS = [100, 1_000, 10_000];

function formatKRW(n: number): string {
  return `₩${Math.round(n).toLocaleString('ko-KR')}`;
}

const T = {
  surface: 'var(--surface-raised, #162032)',
  surfaceSoft: 'rgba(148, 163, 184, 0.06)',
  border: 'var(--border, rgba(30, 41, 59, 0.5))',
  borderStrong: 'var(--border-strong, rgba(51, 65, 85, 0.6))',
  textMain: 'var(--text-main, #FFFFFF)',
  textSecondary: 'var(--text-secondary, #94A3B8)',
  textMuted: 'var(--text-muted, #64748B)',
  primary: 'var(--primary, #10B981)',
  primaryLight: 'var(--primary-light, rgba(16, 185, 129, 0.1))',
  primaryBorder: 'var(--primary-border, rgba(16, 185, 129, 0.3))',
  danger: 'var(--status-danger, #EF4444)',
  dangerBg: 'var(--status-danger-bg, rgba(239, 68, 68, 0.12))',
  warning: 'var(--status-warning, #F59E0B)',
  warningBg: 'var(--status-warning-bg, rgba(245, 158, 11, 0.12))',
  success: 'var(--status-success, #10B981)',
  successBg: 'var(--status-success-bg, rgba(16, 185, 129, 0.12))',
  radius: 'var(--radius-md, 8px)',
  radiusLg: 'var(--radius-lg, 12px)',
};

export default function CreditAdjustModal({
  type,
  userEmail,
  userName,
  currentCredits,
  costPerMessage,
  dailyCreditLimit,
  usedToday = 0,
  loading,
  onClose,
  onSubmit,
}: Props) {
  // 부모는 open=true 일 때만 마운트한다(close 시 unmount) → useState 초기값만으로 폼 리셋 충분.
  const [count, setCount] = useState<string>('');
  const [reason, setReason] = useState<string>('');

  const numericCount = useMemo(() => {
    const n = parseFloat(count);
    if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) return 0;
    return n;
  }, [count]);

  const absKrw = numericCount * costPerMessage;
  const isAdd = type === 'ADMIN_ADD';
  const signed = isAdd ? absKrw : -absKrw;
  const projectedBalance = currentCredits + signed;
  const insufficient = !isAdd && absKrw > currentCredits && absKrw > 0;
  const dailyLimit = Number(dailyCreditLimit ?? 0);
  const dailyRemaining = dailyLimit > 0 ? Math.max(0, dailyLimit - usedToday) : Number.POSITIVE_INFINITY;
  const exceedsDaily = isAdd && dailyLimit > 0 && absKrw > dailyRemaining;
  const reasonLen = reason.length;
  const reasonOk = reasonLen >= 10 && reasonLen <= 500;
  const costMissing = costPerMessage <= 0;

  const disabled =
    loading ||
    costMissing ||
    numericCount <= 0 ||
    !reasonOk ||
    insufficient ||
    exceedsDaily;

  // disabled 인 정확한 이유 — UX 디버그 보조.
  let disabledReason: string | null = null;
  if (!loading) {
    if (costMissing) {
      disabledReason = '단가가 설정되지 않아 건수 지급/차감을 할 수 없습니다. 빌링 카드에서 단가를 먼저 설정하세요.';
    } else if (numericCount <= 0) {
      disabledReason = '건수를 입력하세요 (1 이상 정수).';
    } else if (insufficient) {
      disabledReason = `잔액 부족 — ${formatKRW(absKrw - currentCredits)} 모자랍니다.`;
    } else if (exceedsDaily) {
      disabledReason = `관리자 일일 지급 한도 초과 — 잔여 ${formatKRW(dailyRemaining)}`;
    } else if (reasonLen === 0) {
      disabledReason = '사유 10자 이상 입력해야 처리됩니다.';
    } else if (reasonLen < 10) {
      disabledReason = `사유 ${10 - reasonLen}자 더 입력하세요.`;
    } else if (reasonLen > 500) {
      disabledReason = '사유는 500자를 넘을 수 없습니다.';
    }
  }

  function handleSubmit() {
    if (disabled) return;
    onSubmit({ unit: 'COUNT', type, count: numericCount, reason });
  }

  const title = isAdd ? '건수 지급' : '건수 차감';

  const userLabel = userName ?? userEmail ?? '대상 유저';
  const accent = isAdd ? T.success : T.danger;

  function presetStyle(): React.CSSProperties {
    return {
      padding: '6px 10px',
      borderRadius: '999px',
      border: `1px solid ${T.borderStrong}`,
      background: T.surfaceSoft,
      color: T.textSecondary,
      fontSize: '12px',
      cursor: loading ? 'not-allowed' : 'pointer',
      opacity: loading ? 0.5 : 1,
      transition: 'all 150ms ease',
    };
  }

  return (
    <div
      className="modal-overlay"
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
        aria-label={title}
        style={{
          width: '100%',
          maxWidth: '500px',
          background: T.surface,
          border: `1px solid ${T.borderStrong}`,
          borderRadius: T.radiusLg,
          boxShadow: '0 24px 60px rgba(0,0,0,0.55)',
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
                background: isAdd ? T.successBg : T.dangerBg,
                color: accent,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: `1px solid ${accent}33`,
              }}
            >
              {isAdd ? <Plus size={18} /> : <Minus size={18} />}
            </span>
            <h3 style={{ margin: 0, fontSize: '17px', fontWeight: 700 }}>{title}</h3>
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

        {/* Subject row */}
        <div
          style={{
            padding: '14px 20px',
            borderBottom: `1px solid ${T.border}`,
            display: 'flex',
            flexWrap: 'wrap',
            gap: '6px 16px',
            fontSize: '13px',
            color: T.textSecondary,
          }}
        >
          <span>
            <span style={{ color: T.textMuted }}>유저</span>{' '}
            <strong style={{ color: T.textMain, fontWeight: 600 }}>{userLabel}</strong>
          </span>
          <span>
            <span style={{ color: T.textMuted }}>현재 잔액</span>{' '}
            <strong style={{ color: T.textMain, fontWeight: 600 }}>{formatKRW(currentCredits)}</strong>
          </span>
          {costPerMessage > 0 && (
            <span>
              <span style={{ color: T.textMuted }}>단가</span>{' '}
              <strong style={{ color: T.textMain, fontWeight: 600 }}>{formatKRW(costPerMessage)}</strong>
              <span style={{ color: T.textMuted }}>/건</span>
            </span>
          )}
        </div>

        {/* Body */}
        <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {costMissing && (
            <div
              role="alert"
              style={{
                padding: '12px 14px',
                background: T.warningBg,
                border: `1px solid ${T.warning}33`,
                borderRadius: T.radius,
                fontSize: '13px',
                color: T.warning,
                display: 'flex',
                gap: 8,
                alignItems: 'flex-start',
              }}
            >
              <AlertTriangle size={14} style={{ marginTop: 2 }} />
              <span>단가(건당 비용)가 0원입니다. 건수 지급/차감은 단가가 설정된 후에만 가능합니다. 빌링 카드의 <strong>단가 수정</strong>을 먼저 진행하세요.</span>
            </div>
          )}

          {/* 빠른 입력 */}
          <div>
            <div style={{ fontSize: '12px', color: T.textMuted, marginBottom: 8, fontWeight: 600, letterSpacing: '0.02em' }}>빠른 입력 (건)</div>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {COUNT_PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setCount(String(p))}
                  disabled={loading || costMissing}
                  style={presetStyle()}
                >
                  {p.toLocaleString('ko-KR')}건
                </button>
              ))}
            </div>
          </div>

          {/* 입력 */}
          <div>
            <label
              htmlFor="credit-amount-input"
              style={{ display: 'block', fontSize: '12px', color: T.textMuted, marginBottom: 6, fontWeight: 600 }}
            >
              건수 (건)
            </label>
            <input
              id="credit-amount-input"
              type="number"
              min={1}
              step={1}
              value={count}
              onChange={(e) => setCount(e.target.value)}
              placeholder="지급할 건수를 입력하세요 (정수)"
              autoComplete="off"
              autoFocus
              disabled={loading || costMissing}
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: T.radius,
                border: `1px solid ${numericCount > 0 ? T.primaryBorder : T.borderStrong}`,
                background: T.surfaceSoft,
                color: T.textMain,
                fontSize: '15px',
                outline: 'none',
              }}
            />
            {numericCount > 0 && (
              <div
                style={{
                  marginTop: '10px',
                  padding: '12px 14px',
                  background: isAdd ? T.successBg : T.dangerBg,
                  border: `1px solid ${accent}33`,
                  borderRadius: T.radius,
                  fontSize: '13px',
                  lineHeight: 1.55,
                  color: T.textSecondary,
                }}
              >
                <div style={{ marginBottom: 4 }}>
                  <Info size={12} style={{ verticalAlign: '-1px', marginRight: 4 }} />
                  {numericCount.toLocaleString('ko-KR')}건 × {formatKRW(costPerMessage)} ={' '}
                  <strong style={{ color: T.textMain }}>{formatKRW(absKrw)}</strong> {isAdd ? '적립' : '차감'}
                </div>
                <div>
                  현재 <strong style={{ color: T.textMain }}>{formatKRW(currentCredits)}</strong> → 변경 후{' '}
                  <strong style={{ color: accent, fontSize: '15px' }}>{formatKRW(projectedBalance)}</strong>{' '}
                  <span style={{ color: T.textMuted }}>({isAdd ? '+' : ''}{formatKRW(signed)})</span>
                </div>
                {insufficient && (
                  <div style={{ color: T.danger, marginTop: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <AlertTriangle size={12} /> 잔액 부족: {formatKRW(absKrw - currentCredits)} 모자랍니다.
                  </div>
                )}
                {exceedsDaily && (
                  <div style={{ color: T.danger, marginTop: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <AlertTriangle size={12} /> 관리자 일일 지급 한도 초과: 잔여 {formatKRW(dailyRemaining)}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 사유 */}
          <div>
            <label
              htmlFor="credit-reason-input"
              style={{ display: 'block', fontSize: '12px', color: T.textMuted, marginBottom: 6, fontWeight: 600 }}
            >
              사유 <span style={{ color: T.textMuted, fontWeight: 400 }}>(10자 이상 500자 이하, 감사 로그에 영구 기록)</span>
            </label>
            <textarea
              id="credit-reason-input"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value.slice(0, 500))}
              placeholder="예) 고객 요청으로 50만원 환불 처리. 티켓 #1234"
              disabled={loading}
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: T.radius,
                border: `1px solid ${reasonOk ? T.primaryBorder : reasonLen > 0 ? T.warning : T.borderStrong}`,
                background: T.surfaceSoft,
                color: T.textMain,
                fontSize: '14px',
                resize: 'vertical',
                fontFamily: 'inherit',
                outline: 'none',
                minHeight: '72px',
              }}
            />
            <div
              style={{
                fontSize: '11.5px',
                color: reasonOk ? T.success : reasonLen === 0 ? T.textMuted : T.warning,
                marginTop: 4,
                display: 'flex',
                justifyContent: 'space-between',
              }}
            >
              <span>
                {reasonLen > 0 && reasonLen < 10 && `${10 - reasonLen}자 더 입력 필요`}
                {reasonOk && '사유 OK'}
              </span>
              <span style={{ color: T.textMuted }}>{reasonLen}/500</span>
            </div>
          </div>

          {/* Disabled 사유 안내 (왜 버튼이 비활성인지) */}
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
              padding: '10px 20px',
              borderRadius: T.radius,
              border: `1px solid ${disabled ? T.borderStrong : accent}`,
              background: disabled ? T.surfaceSoft : accent,
              color: disabled ? T.textMuted : '#FFFFFF',
              cursor: disabled ? 'not-allowed' : 'pointer',
              fontSize: '14px',
              fontWeight: 700,
              minWidth: '140px',
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
                  border: '2px solid rgba(255,255,255,0.4)',
                  borderTopColor: '#fff',
                  borderRadius: '50%',
                  animation: 'spin 0.8s linear infinite',
                  display: 'inline-block',
                }}
              />
            )}
            {isAdd ? '건수 지급' : '건수 차감'}
            {numericCount > 0 && !insufficient && !exceedsDaily && (
              <> · {numericCount.toLocaleString('ko-KR')}건 ({formatKRW(absKrw)})</>
            )}
          </button>
        </div>
      </div>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        #credit-amount-input::-webkit-outer-spin-button,
        #credit-amount-input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
        #credit-amount-input { -moz-appearance: textfield; }
      `}</style>
    </div>
  );
}
