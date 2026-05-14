'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Zap, Copy, CheckCircle2, AlertTriangle, Clock, Loader2,
  ArrowRight, ExternalLink, Shield, Radio, RefreshCw, XCircle
} from 'lucide-react';
import { useUpbitPrice } from './use-upbit-price';

interface DepositData {
  id: string;
  usdtAmount: number;
  exchangeRate: number;
  krwAmount: number;
  creditAmount: number;
  walletAddress: string;
  expiresAt: string;
  status: string;
}

type Step = 'amount' | 'payment' | 'verify' | 'complete';

interface UsdtDepositClientProps {
  costPerMessageKrw: number;
}

function ceilToSixDecimals(value: number) {
  return Math.ceil(value * 1_000_000) / 1_000_000;
}

export default function UsdtDepositClient({ costPerMessageKrw }: UsdtDepositClientProps) {
  const router = useRouter();
  const { priceData, connected } = useUpbitPrice();

  // 단계 관리
  const [step, setStep] = useState<Step>('amount');

  // Step 1: 발송건수 입력
  const [messageCount, setMessageCount] = useState('');
  const [loading, setLoading] = useState(false);

  // Step 2: 입금 대기
  const [deposit, setDeposit] = useState<DepositData | null>(null);
  const [copied, setCopied] = useState(false);
  const [countdown, setCountdown] = useState(0);

  // Step 3: TXID 검증
  const [txid, setTxid] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<{
    success: boolean;
    message: string;
    retryable?: boolean;
    data?: {
      creditAmount: number;
      newBalance: number;
      usdtAmount: number;
    };
  } | null>(null);

  // 실시간 KRW 환산 금액
  const currentPrice = priceData?.price || 0;
  const requestedMessageCount = Math.floor(Number(messageCount)) || 0;
  const estimatedKrw = Math.round(requestedMessageCount * costPerMessageKrw);
  const rawEstimatedUsdt = currentPrice > 0 ? estimatedKrw / currentPrice : 0;
  const estimatedUsdt = rawEstimatedUsdt > 0 ? ceilToSixDecimals(Math.max(1, rawEstimatedUsdt)) : 0;
  const estimatedCoveredMessages =
    currentPrice > 0 && costPerMessageKrw > 0
      ? Math.floor((estimatedUsdt * currentPrice) / costPerMessageKrw)
      : 0;


  // 타이머
  useEffect(() => {
    if (!deposit?.expiresAt) return;

    const interval = setInterval(() => {
      const remaining = Math.max(0, Math.floor((new Date(deposit.expiresAt).getTime() - Date.now()) / 1000));
      setCountdown(remaining);
      if (remaining <= 0) {
        clearInterval(interval);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [deposit?.expiresAt]);

  // 입금 신청
  const handleCreateDeposit = async () => {
    if (!requestedMessageCount || requestedMessageCount < 1) return;
    setLoading(true);

    try {
      const res = await fetch('/api/usdt/deposit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageCount: requestedMessageCount }),
      });

      const data = await res.json();

      if (!res.ok) {
        setVerifyResult({ success: false, message: data.error });
        return;
      }

      setDeposit(data.deposit);
      setStep('payment');
      setVerifyResult(null);
    } catch {
      setVerifyResult({ success: false, message: '서버 연결에 실패했습니다.' });
    } finally {
      setLoading(false);
    }
  };

  // 주소 복사
  const handleCopy = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
      const el = document.createElement('textarea');
      el.value = text;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, []);

  // TXID 검증
  const handleVerify = async () => {
    if (!txid.trim() || !deposit) return;
    setVerifying(true);
    setVerifyResult(null);

    try {
      const res = await fetch('/api/usdt/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ depositId: deposit.id, txid: txid.trim() }),
      });

      const data = await res.json();

      if (data.success) {
        setVerifyResult({
          success: true,
          message: data.message,
          data: data.data,
        });
        setStep('complete');
        router.refresh();
      } else {
        setVerifyResult({
          success: false,
          message: data.error,
          retryable: data.retryable,
        });
      }
    } catch {
      setVerifyResult({ success: false, message: '서버 연결에 실패했습니다.' });
    } finally {
      setVerifying(false);
    }
  };

  // 발송건수 프리셋
  const presets = [1000, 5000, 10000, 50000, 100000];

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* 실시간 시세 패널 */}
      <div className="glass-card" style={{
        padding: '1.5rem 2rem',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        background: '#FFFFFF',
        border: '1px solid #E5E7EB',
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.04)',
        borderRadius: '16px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          {/* USDT 3D 로고 */}
          <div style={{
            width: '56px', height: '56px', borderRadius: '50%',
            background: 'linear-gradient(145deg, #50AF95 0%, #2E8B6E 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 6px 16px rgba(80, 175, 149, 0.35), inset 0 2px 4px rgba(255,255,255,0.3)',
            position: 'relative' as const,
          }}>
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M17.922 17.383v-.002c-.11.008-.677.042-1.942.042-1.01 0-1.721-.03-1.971-.042v.003c-3.888-.171-6.79-.848-6.79-1.658 0-.809 2.902-1.486 6.79-1.66v2.644c.254.018.982.061 1.988.061 1.207 0 1.812-.05 1.925-.06v-2.643c3.88.173 6.775.85 6.775 1.658 0 .81-2.895 1.485-6.775 1.657m0-3.59v-2.366h5.414V7.819H8.595v3.608h5.414v2.365c-4.4.202-7.709 1.074-7.709 2.118 0 1.044 3.309 1.915 7.709 2.118v7.582h3.913v-7.584c4.393-.202 7.694-1.073 7.694-2.116 0-1.043-3.301-1.914-7.694-2.117" fill="#FFFFFF"/>
            </svg>
          </div>
          <div>
            <div style={{ fontSize: '0.8rem', color: '#9CA3AF', marginBottom: '4px', fontWeight: 500, letterSpacing: '0.02em' }}>
              USDT/KRW 실시간 시세
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
              <span style={{ fontSize: '1.75rem', fontWeight: 800, color: '#111827', letterSpacing: '-0.5px' }}>
                ₩{currentPrice.toLocaleString()}
              </span>
              {priceData && (
                <span style={{
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  color: priceData.changeRate >= 0 ? '#10B981' : '#EF4444',
                }}>
                  {priceData.changeRate >= 0 ? '+' : ''}{(priceData.changeRate * 100).toFixed(2)}%
                </span>
              )}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: '0.4rem',
            padding: '0.4rem 0.9rem', borderRadius: '20px',
            fontSize: '0.75rem', fontWeight: 700,
            backgroundColor: connected ? 'rgba(16, 185, 129, 0.08)' : 'rgba(156, 163, 175, 0.1)',
            color: connected ? '#10B981' : '#9CA3AF',
            border: `1px solid ${connected ? 'rgba(16, 185, 129, 0.2)' : 'rgba(156, 163, 175, 0.2)'}`,
          }}>
            <Radio size={10} fill={connected ? '#10B981' : '#9CA3AF'} color={connected ? '#10B981' : '#9CA3AF'} />
            {connected ? 'LIVE' : 'REST'}
          </div>
        </div>
      </div>

      {/* 스텝 인디케이터 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0', justifyContent: 'center', margin: '1rem 0 2rem 0' }}>
        {(['amount', 'payment', 'verify', 'complete'] as Step[]).map((s, i) => {
          const isActive = step === s;
          const isPast = (['amount', 'payment', 'verify', 'complete'].indexOf(step) > i);
          return (
            <div key={s} style={{ display: 'flex', alignItems: 'center' }}>
              <div style={{
                width: '36px', height: '36px', borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '0.85rem', fontWeight: 700,
                backgroundColor: isActive ? '#4F46E5' : isPast ? '#FFFFFF' : '#FFFFFF',
                color: isActive ? '#FFFFFF' : isPast ? '#4B5563' : '#9CA3AF',
                border: isActive ? 'none' : isPast ? '1px solid #D1D5DB' : '1px solid #E5E7EB',
                boxShadow: isActive ? '0 4px 6px -1px rgba(79, 70, 229, 0.3)' : 'none',
                transition: 'all 0.3s ease',
              }}>
                {isPast ? '✓' : i + 1}
              </div>
              {i < 3 && (
                <div style={{
                  width: '60px', height: '1px',
                  backgroundColor: isPast ? '#D1D5DB' : '#E5E7EB',
                  margin: '0 0.25rem',
                  transition: 'background-color 0.3s ease',
                }} />
              )}
            </div>
          );
        })}
      </div>

      {/* Step 1: 발송건수 입력 */}
      {step === 'amount' && (
        <div className="glass-card" style={{ padding: '2rem' }}>
          <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#111827' }}>
            <Zap size={20} color="#4F46E5" />
            충전할 발송건수 입력
          </h3>

          {/* 프리셋 버튼 */}
          <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
            {presets.map((p) => (
              <button
                key={p}
                onClick={() => setMessageCount(String(p))}
                style={{
                  padding: '0.75rem 1.25rem', borderRadius: '8px',
                  fontSize: '0.9rem', fontWeight: 600,
                  backgroundColor: '#FFFFFF',
                  color: messageCount === String(p) ? '#4F46E5' : '#4B5563',
                  border: messageCount === String(p) ? '2px solid #4F46E5' : '1px solid #E5E7EB',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                }}
              >
                {p.toLocaleString()}건
              </button>
            ))}
          </div>

          {/* 발송건수 입력 */}
          <div style={{ position: 'relative', marginBottom: '1.5rem' }}>
            <input
              type="number"
              value={messageCount}
              onChange={(e) => setMessageCount(e.target.value.replace(/\D/g, ''))}
              placeholder="충전할 발송건수를 입력하세요"
              min="1"
              step="1"
              style={{
                width: '100%',
                backgroundColor: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: '8px',
                padding: '1.25rem 5rem 1.25rem 1.5rem',
                color: 'var(--text-main)',
                fontSize: '1.1rem',
                fontWeight: 500,
                outline: 'none',
              }}
            />
            <div style={{
              position: 'absolute', right: '1.5rem', top: '50%', transform: 'translateY(-50%)',
              color: '#9CA3AF', fontSize: '0.9rem', fontWeight: 600,
            }}>
              건
            </div>
          </div>

          {/* 실시간 환산 */}
          {requestedMessageCount > 0 && currentPrice > 0 && (
            <div style={{
              padding: '1.25rem',
              backgroundColor: '#F9FAFB',
              borderRadius: '8px',
              border: '1px solid #E5E7EB',
              marginBottom: '1.5rem',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                <span style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>신청 발송건수</span>
                <span style={{ fontWeight: 600 }}>{requestedMessageCount.toLocaleString()}건</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                <span style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>메시지 단가</span>
                <span style={{ fontWeight: 600 }}>₩{costPerMessageKrw.toLocaleString()}/건</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                <span style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>적용 환율</span>
                <span style={{ fontWeight: 600 }}>₩{currentPrice.toLocaleString()}/USDT</span>
              </div>
              <div style={{ height: '1px', backgroundColor: 'var(--border)', margin: '0.5rem 0' }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                <span style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>필요 KRW 금액</span>
                <span style={{ fontWeight: 700, fontSize: '1.1rem' }}>₩{estimatedKrw.toLocaleString()}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>입금 필요 수량</span>
                <span style={{ fontWeight: 700, fontSize: '1.1rem', color: 'var(--primary)' }}>
                  {estimatedUsdt.toLocaleString(undefined, { maximumFractionDigits: 6 })} USDT
                </span>
              </div>
              {estimatedCoveredMessages > requestedMessageCount && (
                <div style={{ marginTop: '0.75rem', color: '#6B7280', fontSize: '0.78rem', textAlign: 'right' }}>
                  최소 1 USDT 정책으로 약 {estimatedCoveredMessages.toLocaleString()}건까지 충전됩니다.
                </div>
              )}
              <div style={{ marginTop: '0.75rem', color: '#6B7280', fontSize: '0.78rem', textAlign: 'right' }}>
                실제 입금 요청 시점의 서버 시세로 수량이 확정됩니다.
              </div>
            </div>
          )}

          {/* 안내 사항 */}
          <div style={{
            padding: '1.5rem', borderRadius: '8px', marginBottom: '1.5rem',
            backgroundColor: '#FFFBEB',
            border: '1px solid #FEF3C7',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 700, marginBottom: '0.75rem', color: '#F59E0B' }}>
              <AlertTriangle size={16} /> 주의사항
            </div>
            <ul style={{ paddingLeft: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', color: '#F59E0B', fontSize: '0.85rem', fontWeight: 500 }}>
              <li>오직 <strong>TRON(TRC20)</strong> 네트워크만 지원됩니다.</li>
              <li>ERC20 등 다른 네트워크로 보내면 <strong>복구가 불가능</strong>합니다.</li>
              <li>시세는 입금 신청 시점에 고정(Lock)되며, <strong>15분간</strong> 유효합니다.</li>
              <li>발송건수 기준으로 필요한 <strong>USDT 입금 수량</strong>이 자동 계산됩니다.</li>
              <li>최소 입금 수량 정책: <strong>1 USDT</strong></li>
            </ul>
          </div>

          {/* 에러 메시지 */}
          {verifyResult && !verifyResult.success && (
            <div style={{
              padding: '0.75rem 1rem', borderRadius: '8px', marginBottom: '1rem',
              fontSize: '0.875rem',
              backgroundColor: 'rgba(239, 68, 68, 0.1)',
              color: '#ef4444',
              display: 'flex', alignItems: 'center', gap: '0.5rem',
            }}>
              <XCircle size={16} />
              {verifyResult.message}
            </div>
          )}

          <button
            className="btn-primary"
            onClick={handleCreateDeposit}
            disabled={loading || requestedMessageCount < 1 || currentPrice <= 0}
            style={{
              width: '100%', padding: '1rem', fontSize: '1rem', fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
              opacity: (loading || requestedMessageCount < 1 || currentPrice <= 0) ? 0.5 : 1,
            }}
          >
            {loading ? (
              <><Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} /> 처리 중...</>
            ) : (
              <>USDT 입금 수량 확정 <ArrowRight size={18} /></>
            )}
          </button>
        </div>
      )}

      {/* Step 2: 입금 대기 (주소 표시) */}
      {step === 'payment' && deposit && (
        <div className="glass-card" style={{ padding: '2rem' }}>
          {/* 타이머 */}
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            marginBottom: '1.5rem', padding: '1rem',
            backgroundColor: countdown < 120 ? 'rgba(239, 68, 68, 0.08)' : 'rgba(245, 158, 11, 0.08)',
            borderRadius: '10px',
            border: `1px solid ${countdown < 120 ? 'rgba(239, 68, 68, 0.2)' : 'rgba(245, 158, 11, 0.2)'}`,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem' }}>
              <Clock size={16} color={countdown < 120 ? '#ef4444' : '#f59e0b'} />
              <span style={{ color: countdown < 120 ? '#ef4444' : '#f59e0b', fontWeight: 600 }}>시세 Lock 잔여 시간</span>
            </div>
            <span style={{
              fontFamily: 'monospace', fontSize: '1.25rem', fontWeight: 700,
              color: countdown < 120 ? '#ef4444' : '#f59e0b',
            }}>
              {formatTime(countdown)}
            </span>
          </div>

          {/* 입금 정보 */}
          <div style={{
            padding: '1.5rem', borderRadius: '12px',
            backgroundColor: 'var(--surface-hover)',
            border: '1px solid var(--border)',
            marginBottom: '1.5rem',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>입금 수량</span>
              <span style={{ fontWeight: 700, fontSize: '1.1rem' }}>{deposit.usdtAmount} USDT</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>고정 환율</span>
              <span style={{ fontWeight: 600 }}>₩{deposit.exchangeRate.toLocaleString()}/USDT</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>KRW 환산</span>
              <span style={{ fontWeight: 600 }}>₩{deposit.krwAmount.toLocaleString()}</span>
            </div>
            <div style={{ height: '1px', backgroundColor: 'var(--border)', margin: '0.5rem 0' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>충전 건수</span>
              <span style={{ fontWeight: 700, fontSize: '1.25rem', color: 'var(--primary)' }}>
                {deposit.krwAmount > 0 ? Math.floor(deposit.krwAmount / costPerMessageKrw).toLocaleString() : 0}건
              </span>
            </div>
          </div>

          {/* 네트워크 경고 */}
          <div style={{
            padding: '0.75rem 1rem', borderRadius: '8px', marginBottom: '1.5rem',
            background: 'linear-gradient(135deg, rgba(239, 68, 68, 0.08) 0%, rgba(239, 68, 68, 0.02) 100%)',
            border: '1px solid rgba(239, 68, 68, 0.2)',
            display: 'flex', alignItems: 'center', gap: '0.5rem',
            fontSize: '0.8rem', color: '#ef4444', fontWeight: 600,
          }}>
            <Shield size={16} />
            반드시 TRON (TRC20) 네트워크로 전송하세요. 다른 네트워크 입금 시 복구 불가!
          </div>

          {/* 입금 주소 */}
          <div style={{ marginBottom: '1.5rem' }}>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.5rem', fontWeight: 600 }}>
              USDT-TRC20 입금 주소
            </div>
            <div style={{
              display: 'flex', alignItems: 'center', gap: '0.5rem',
              padding: '1rem',
              backgroundColor: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: '10px',
            }}>
              <code style={{
                flex: 1, fontSize: '0.9rem', fontFamily: 'monospace',
                letterSpacing: '0.5px', wordBreak: 'break-all', color: 'var(--text-main)',
              }}>
                {deposit.walletAddress}
              </code>
              <button
                onClick={() => handleCopy(deposit.walletAddress)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '0.25rem',
                  padding: '0.5rem 1rem', borderRadius: '8px',
                  backgroundColor: copied ? 'rgba(255, 255, 255, 0.2)' : 'var(--surface)',
                  color: copied ? 'var(--primary)' : 'var(--text-secondary)',
                  border: '1px solid var(--border)',
                  fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  whiteSpace: 'nowrap',
                }}
              >
                {copied ? <><CheckCircle2 size={14} /> 복사됨</> : <><Copy size={14} /> 복사</>}
              </button>
            </div>
          </div>

          <button
            className="btn-primary"
            onClick={() => setStep('verify')}
            style={{
              width: '100%', padding: '1rem', fontSize: '1rem', fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
            }}
          >
            송금 완료 — TXID 입력하기 <ArrowRight size={18} />
          </button>
        </div>
      )}

      {/* Step 3: TXID 입력 & 검증 */}
      {step === 'verify' && deposit && (
        <div className="glass-card" style={{ padding: '2rem' }}>
          <h3 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Shield size={20} color="var(--primary)" />
            트랜잭션 ID (TXID) 검증
          </h3>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>
            송금 완료 후, 해당 거래의 Transaction Hash를 입력해 주세요.
          </p>

          {/* 타이머 */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: '0.5rem',
            marginBottom: '1rem', fontSize: '0.8rem',
            color: countdown < 120 ? '#ef4444' : 'var(--text-secondary)',
          }}>
            <Clock size={14} />
            잔여 시간: <strong>{formatTime(countdown)}</strong>
          </div>

          {/* TXID 입력 */}
          <div style={{ marginBottom: '1.5rem' }}>
            <input
              type="text"
              value={txid}
              onChange={(e) => setTxid(e.target.value.trim())}
              placeholder="트랜잭션 해시를 입력하세요 (64자리)"
              style={{
                width: '100%',
                backgroundColor: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: '10px',
                padding: '1rem 1.25rem',
                color: 'var(--text-main)',
                fontSize: '0.875rem',
                fontFamily: 'monospace',
                letterSpacing: '0.5px',
                outline: 'none',
              }}
              onFocus={(e) => e.target.style.borderColor = 'var(--primary)'}
              onBlur={(e) => e.target.style.borderColor = 'var(--border)'}
            />
            {txid && (
              <a
                href={`https://tronscan.org/#/transaction/${txid}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: '0.25rem',
                  fontSize: '0.75rem', color: 'var(--primary)', marginTop: '0.5rem',
                }}
              >
                TronScan에서 확인 <ExternalLink size={12} />
              </a>
            )}
          </div>

          {/* 검증 결과 */}
          {verifyResult && (
            <div style={{
              padding: '1rem', borderRadius: '10px', marginBottom: '1rem',
              backgroundColor: verifyResult.success ? 'rgba(255, 255, 255, 0.1)' : 'rgba(239, 68, 68, 0.1)',
              border: `1px solid ${verifyResult.success ? 'rgba(255, 255, 255, 0.2)' : 'rgba(239, 68, 68, 0.2)'}`,
              color: verifyResult.success ? 'var(--primary)' : '#ef4444',
              fontSize: '0.875rem',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600 }}>
                {verifyResult.success ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
                {verifyResult.message}
              </div>
              {verifyResult.retryable && (
                <div style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                  블록체인 확인에 시간이 걸릴 수 있습니다. 1~2분 후 다시 시도해 주세요.
                </div>
              )}
            </div>
          )}

          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button
              onClick={() => setStep('payment')}
              className="glass-card"
              style={{
                padding: '1rem 1.5rem', fontWeight: 600, cursor: 'pointer',
                color: 'var(--text-secondary)', fontSize: '0.875rem',
              }}
            >
              ← 뒤로
            </button>
            <button
              className="btn-primary"
              onClick={handleVerify}
              disabled={verifying || !txid.trim() || txid.replace(/^0x/, '').length !== 64}
              style={{
                flex: 1, padding: '1rem', fontSize: '1rem', fontWeight: 700,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
                opacity: (verifying || !txid.trim()) ? 0.5 : 1,
              }}
            >
              {verifying ? (
                <><Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} /> 블록체인 검증 중...</>
              ) : (
                <><RefreshCw size={18} /> TXID 검증하기</>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Step 4: 충전 완료 */}
      {step === 'complete' && verifyResult?.success && verifyResult.data && (
        <div className="glass-card" style={{
          padding: '3rem 2rem', textAlign: 'center',
          background: 'linear-gradient(135deg, var(--primary) 0%, #818cf8 100%)',
        }}>
          <div style={{
            width: '72px', height: '72px', borderRadius: '50%', margin: '0 auto 1.5rem',
            background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.2), rgba(255, 255, 255, 0.05))',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: '2px solid rgba(255, 255, 255, 0.3)',
          }}>
            <CheckCircle2 size={36} color="#000" />
          </div>

          <h3 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.5rem' }}>
            충전 완료!
          </h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '2rem' }}>
            USDT 입금이 확인되어 크레딧이 즉시 충전되었습니다.
          </p>

          <div style={{
            padding: '1.5rem', borderRadius: '12px',
            backgroundColor: 'var(--surface-hover)',
            border: '1px solid var(--border)',
            marginBottom: '2rem', textAlign: 'left',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>입금 수량</span>
              <span style={{ fontWeight: 600 }}>{verifyResult.data.usdtAmount} USDT</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>충전 건수</span>
              <span style={{ fontWeight: 700, color: 'var(--primary)' }}>
                {deposit?.krwAmount ? Math.floor(deposit.krwAmount / costPerMessageKrw).toLocaleString() : 0}건
              </span>
            </div>
            <div style={{ height: '1px', backgroundColor: 'var(--border)', margin: '0.5rem 0' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>현재 잔액</span>
              <span style={{ fontWeight: 700, fontSize: '1.25rem' }}>${verifyResult.data.newBalance.toFixed(2)} USD</span>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button
              className="glass-card"
              onClick={() => {
                setStep('amount');
                setDeposit(null);
                setTxid('');
                setMessageCount('');
                setVerifyResult(null);
              }}
              style={{ flex: 1, padding: '1rem', fontWeight: 600, cursor: 'pointer' }}
            >
              추가 충전
            </button>
            <a
              href="/dashboard/sms-send"
              className="btn-primary"
              style={{
                flex: 1, padding: '1rem', fontWeight: 700,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
                textDecoration: 'none',
              }}
            >
              문자 발송 시작하기
            </a>
          </div>
        </div>
      )}

      {/* CSS 키프레임 */}
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
