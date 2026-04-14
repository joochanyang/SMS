'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Ticket, CheckCircle2 } from 'lucide-react';

export default function CouponRedeem() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  const handleRedeem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return;

    setLoading(true);
    setResult(null);

    try {
      const res = await fetch('/api/credits/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim() }),
      });

      const data = await res.json();

      if (!res.ok) {
        setResult({ success: false, message: data.error });
      } else {
        setResult({ success: true, message: `$${data.credited} 크레딧이 충전되었습니다! 잔액: $${data.newBalance.toFixed(2)}` });
        setCode('');
        router.refresh();
      }
    } catch {
      setResult({ success: false, message: '서버 연결에 실패했습니다.' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="glass-card" style={{ padding: '2rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <h3 style={{ fontSize: '1.125rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <Ticket size={20} color="var(--primary)" />
        쿠폰 코드 충전
      </h3>
      <form onSubmit={handleRedeem} style={{ display: 'flex', gap: '0.75rem' }}>
        <input
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="쿠폰 코드를 입력하세요"
          maxLength={20}
          style={{
            flex: 1,
            backgroundColor: 'rgba(15, 23, 42, 0.8)',
            border: '1px solid var(--border)',
            borderRadius: '8px',
            padding: '0.75rem 1rem',
            color: 'var(--text-main)',
            outline: 'none',
            fontFamily: 'monospace',
            letterSpacing: '2px',
            fontSize: '1rem',
          }}
          onFocus={(e) => e.target.style.borderColor = 'var(--primary)'}
          onBlur={(e) => e.target.style.borderColor = 'var(--border)'}
        />
        <button
          type="submit"
          className="btn-primary"
          disabled={loading || !code.trim()}
          style={{ padding: '0.75rem 1.5rem', whiteSpace: 'nowrap' }}
        >
          {loading ? '처리 중...' : '충전'}
        </button>
      </form>
      {result && (
        <div style={{
          padding: '0.75rem 1rem',
          borderRadius: '8px',
          fontSize: '0.875rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          backgroundColor: result.success ? 'rgba(255, 255, 255, 0.1)' : 'rgba(239, 68, 68, 0.1)',
          color: result.success ? 'var(--text-main)' : '#ef4444',
        }}>
          {result.success && <CheckCircle2 size={16} />}
          {result.message}
        </div>
      )}
    </div>
  );
}
