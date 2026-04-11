import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { redirect } from 'next/navigation';
import { CreditCard, ArrowUpRight, ArrowDownLeft, Bitcoin, ShieldCheck, Zap, Info } from 'lucide-react';
import CouponRedeem from './coupon-redeem';

function formatDateOnly(date: Date) {
  return new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

export default async function WalletPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect('/login');

  const [user, transactions] = await Promise.all([
    prisma.user.findUnique({
      where: { id: session.user.id },
      select: { credits: true },
    }),
    prisma.transaction.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        type: true,
        amount: true,
        description: true,
        createdAt: true,
      },
    }),
  ]);

  const balance = user?.credits ?? 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 700 }}>지갑 / 크레딧</h2>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', color: 'var(--primary)', backgroundColor: 'rgba(16, 185, 129, 0.1)', padding: '0.5rem 1rem', borderRadius: '8px', fontSize: '0.875rem', fontWeight: 600 }}>
          <ShieldCheck size={16} /> 안전 결제
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>
        {/* 잔액 카드 */}
        <div className="glass-card" style={{
          padding: '2rem', background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.9) 0%, rgba(16, 185, 129, 0.1) 100%)',
          display: 'flex', flexDirection: 'column', justifyContent: 'space-between', position: 'relative', overflow: 'hidden'
        }}>
          <div style={{ position: 'absolute', right: '-20px', top: '-20px', opacity: 0.1 }}>
            <Zap size={150} color="var(--primary)" />
          </div>
          <div>
            <div style={{ color: 'var(--text-secondary)', fontSize: '1rem', marginBottom: '0.5rem' }}>사용 가능 잔액</div>
            <div style={{ fontSize: '3rem', fontWeight: 700, letterSpacing: '-1px' }}>${balance.toFixed(2)} <span style={{ fontSize: '1.25rem', color: 'var(--text-secondary)', fontWeight: 500 }}>USD</span></div>
          </div>
          <div style={{ marginTop: '3rem', display: 'flex', gap: '1rem' }}>
            <button className="btn-primary" style={{ flex: 1, padding: '1rem' }}>충전하기</button>
            <button className="glass-card" style={{ flex: 1, padding: '1rem', fontWeight: 600 }}>거래 내역</button>
          </div>
        </div>

        {/* 결제 수단 */}
        <div className="glass-card" style={{ padding: '2rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <h3 style={{ fontSize: '1.125rem', fontWeight: 600 }}>크레딧 충전</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div className="glass-card" style={{ padding: '1.5rem', cursor: 'pointer', border: '1px solid var(--primary)' }}>
              <CreditCard size={24} color="var(--primary)" style={{ marginBottom: '1rem' }} />
              <div style={{ fontWeight: 600, fontSize: '1rem' }}>카드 결제</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Stripe / Visa 즉시 충전</div>
            </div>
            <div className="glass-card" style={{ padding: '1.5rem', cursor: 'pointer' }}>
              <Bitcoin size={24} color="#f59e0b" style={{ marginBottom: '1rem' }} />
              <div style={{ fontWeight: 600, fontSize: '1rem' }}>USDT (TRC-20)</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>암호화폐 결제</div>
            </div>
          </div>
          <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Info size={14} /> 환율은 5분마다 자동 업데이트됩니다.
          </div>
        </div>
      </div>

      {/* 쿠폰 충전 */}
      <CouponRedeem />

      {/* 최근 거래 내역 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 600 }}>최근 거래 내역</h3>
        <div className="glass-card" style={{ padding: '0', overflow: 'hidden' }}>
          {transactions.map((tx) => (
            <div key={tx.id} style={{ padding: '1.25rem', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <div style={{
                  width: '40px', height: '40px', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  backgroundColor: tx.type === 'DEPOSIT' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                  color: tx.type === 'DEPOSIT' ? 'var(--primary)' : '#ef4444'
                }}>
                  {tx.type === 'DEPOSIT' ? <ArrowDownLeft size={20} /> : <ArrowUpRight size={20} />}
                </div>
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>{tx.description || tx.type}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{tx.id} • {formatDateOnly(tx.createdAt)}</div>
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontWeight: 700, color: Number(tx.amount) >= 0 ? 'var(--primary)' : 'var(--text-main)' }}>
                  {Number(tx.amount) >= 0 ? '+' : ''}${Math.abs(Number(tx.amount)).toFixed(2)}
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--primary)' }}>완료</div>
              </div>
            </div>
          ))}
          {transactions.length === 0 && (
            <div style={{ padding: '1.25rem', color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
              아직 거래 내역이 없습니다.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
