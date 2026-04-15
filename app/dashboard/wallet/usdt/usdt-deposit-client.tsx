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

export default function UsdtDepositClient() {
  const router = useRouter();
  const { priceData, connected } = useUpbitPrice();

  // 단계 관리
  const [step, setStep] = useState<Step>('amount');

  // Step 1: 수량 입력
  const [usdtAmount, setUsdtAmount] = useState('');
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
  const inputAmount = parseFloat(usdtAmount) || 0;
  const estimatedKrw = Math.round(inputAmount * currentPrice);


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
    if (!inputAmount || inputAmount < 1) return;
    setLoading(true);

    try {
      const res = await fetch('/api/usdt/deposit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usdtAmount: inputAmount }),
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

  // 금액 프리셋
  const presets = [10, 50, 100, 500, 1000];

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
        background: 'linear-gradient(90deg, #374151 0%, #FFFFFF 100%)',
        border: 'none',
        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{
            width: '56px', height: '56px', borderRadius: '16px',
            background: '#FFFFFF',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 800, fontSize: '0.85rem', color: '#111827',
            boxShadow: '0 2px 4px rgba(0,0,0,0.05)'
          }}>
            USDT
          </div>
          <div>
            <div style={{ fontSize: '0.85rem', color: '#6B7280', marginBottom: '2px', fontWeight: 600 }}>
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
                  color: '#111827',
                }}>
                  {priceData.changeRate >= 0 ? '+' : ''}{(priceData.changeRate * 100).toFixed(2)}%
                </span>
              )}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: '0.35rem',
            padding: '0.5rem 1rem', borderRadius: '20px',
            fontSize: '0.8rem', fontWeight: 700,
            backgroundColor: 'rgba(0,0,0,0.05)',
            color: '#111827',
          }}>
            <Radio size={12} fill="#ef4444" color="#ef4444" />
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

      {/* Step 1: 수량 입력 */}
      {step === 'amount' && (
        <div className="glass-card" style={{ padding: '2rem' }}>
          <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#111827' }}>
            <Zap size={20} color="#4F46E5" />
            USDT 입금 수량 입력
          </h3>

          {/* 프리셋 버튼 */}
          <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
            {presets.map((p) => (
              <button
                key={p}
                onClick={() => setUsdtAmount(String(p))}
                style={{
                  padding: '0.75rem 1.25rem', borderRadius: '8px',
                  fontSize: '0.9rem', fontWeight: 600,
                  backgroundColor: '#FFFFFF',
                  color: usdtAmount === String(p) ? '#4F46E5' : '#4B5563',
                  border: usdtAmount === String(p) ? '2px solid #4F46E5' : '1px solid #E5E7EB',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                }}
              >
                {p} USDT
              </button>
            ))}
          </div>

          {/* 수량 입력 */}
          <div style={{ position: 'relative', marginBottom: '1.5rem' }}>
            <input
              type="number"
              value={usdtAmount}
              onChange={(e) => setUsdtAmount(e.target.value)}
              placeholder="USDT 수량을 입력하세요"
              min="1"
              max="100000"
              step="any"
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
              USDT
            </div>
          </div>

          {/* 실시간 환산 */}
          {inputAmount > 0 && currentPrice > 0 && (
            <div style={{
              padding: '1.25rem',
              backgroundColor: '#F9FAFB',
              borderRadius: '8px',
              border: '1px solid #E5E7EB',
              marginBottom: '1.5rem',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                <span style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>입금 수량</span>
                <span style={{ fontWeight: 600 }}>{inputAmount.toLocaleString()} USDT</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                <span style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>적용 환율</span>
                <span style={{ fontWeight: 600 }}>₩{currentPrice.toLocaleString()}/USDT</span>
              </div>
              <div style={{ height: '1px', backgroundColor: 'var(--border)', margin: '0.5rem 0' }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                <span style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>KRW 환산 금액</span>
                <span style={{ fontWeight: 700, fontSize: '1.1rem' }}>₩{estimatedKrw.toLocaleString()}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>충전 건수</span>
                <span style={{ fontWeight: 700, fontSize: '1.1rem', color: 'var(--primary)' }}>{estimatedKrw > 0 ? Math.floor(estimatedKrw / 14).toLocaleString() : 0}건</span>
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
              <li>최소 입금 수량: <strong>1 USDT</strong></li>
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
            disabled={loading || inputAmount < 1 || currentPrice <= 0}
            style={{
              width: '100%', padding: '1rem', fontSize: '1rem', fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
              opacity: (loading || inputAmount < 1 || currentPrice <= 0) ? 0.5 : 1,
            }}
          >
            {loading ? (
              <><Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} /> 처리 중...</>
            ) : (
              <>입금 신청 <ArrowRight size={18} /></>
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
              <span style={{ fontWeight: 700, fontSize: '1.25rem', color: 'var(--primary)' }}>{deposit.krwAmount > 0 ? Math.floor(deposit.krwAmount / 14).toLocaleString() : 0}건</span>
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
              <span style={{ fontWeight: 700, color: 'var(--primary)' }}>{deposit?.krwAmount ? Math.floor(deposit.krwAmount / 14).toLocaleString() : 0}건</span>
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
                setUsdtAmount('');
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
