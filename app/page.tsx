'use client';

import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { Shield, Zap, Globe2 } from 'lucide-react';

export default function Home() {
  const router = useRouter();
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header className="glass-header" style={{
        position: 'fixed', top: 0, left: 0, right: 0, height: '70px',
        display: 'flex', alignItems: 'center', padding: '0 2rem',
        justifyContent: 'space-between', zIndex: 10
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 700, fontSize: '1.25rem' }}>
          <Globe2 color="var(--primary)" />
          <span>Sovereign<span style={{ color: 'var(--primary)' }}>SMS</span></span>
        </div>
        <nav style={{ display: 'flex', gap: '1.5rem', alignItems: 'center' }}>
          <span style={{ color: 'var(--text-secondary)', cursor: 'pointer' }}>요금안내</span>
          <span style={{ color: 'var(--text-secondary)', cursor: 'pointer' }} onClick={() => router.push('/dashboard/sms-send')}>대시보드</span>
          <button className="btn-primary" onClick={() => router.push('/login')}>로그인</button>
        </nav>
      </header>

      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '100px 2rem 4rem', textAlign: 'center' }}>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          style={{ maxWidth: '800px' }}
        >
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: '0.5rem',
            padding: '0.5rem 1rem', borderRadius: '999px',
            backgroundColor: 'rgba(16, 185, 129, 0.1)', color: 'var(--primary)',
            fontSize: '0.875rem', fontWeight: 500, marginBottom: '2rem'
          }}>
            <Zap size={16} /> 글로벌 전달률 99.9%
          </div>
          <h1 style={{ fontSize: '4rem', fontWeight: 700, lineHeight: 1.1, marginBottom: '1.5rem' }}>
            대량 문자 발송,<br />
            <span style={{ color: 'var(--text-secondary)' }}>정확하고 빠르게.</span>
          </h1>
          <p style={{ fontSize: '1.25rem', color: 'var(--text-secondary)', marginBottom: '3rem', maxWidth: '600px', margin: '0 auto 3rem' }}>
            190개국 이상 직접 라우팅. 마케팅 캠페인, 알림, 인증 문자를 안전하고 빠르게 발송하세요.
          </p>
          <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
            <button className="btn-primary" style={{ padding: '1rem 2.5rem', fontSize: '1.125rem' }} onClick={() => router.push('/register')}>무료로 시작하기</button>
            <button className="glass-card" style={{
              padding: '1rem 2.5rem', fontSize: '1.125rem', fontWeight: 500,
              display: 'flex', alignItems: 'center', gap: '0.5rem'
            }} onClick={() => router.push('/login')}>
              로그인
            </button>
          </div>
        </motion.div>

        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
          gap: '2rem', width: '100%', maxWidth: '1200px', marginTop: '6rem'
        }}>
          {[
            { tag: '글로벌 커버리지', title: '190개국 직접 발송', desc: '전 세계 어디든 최소 지연으로 문자를 전달합니다.' },
            { tag: '실시간 추적', title: '발송 상태 모니터링', desc: '발송부터 수신까지 실시간 상태 추적과 전달 보고서를 제공합니다.' },
            { tag: '대량 발송', title: 'CSV 일괄 업로드', desc: '수만 건의 번호를 CSV로 업로드하고 자동 배치 발송할 수 있습니다.' },
          ].map((feat, i) => (
            <motion.div
              key={feat.title}
              className="glass-card"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.2 + i * 0.1 }}
              style={{ padding: '2rem', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: '1rem' }}
            >
              <div style={{
                width: '48px', height: '48px', borderRadius: '12px',
                backgroundColor: 'rgba(16, 185, 129, 0.1)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'var(--primary)'
              }}>
                <Shield size={24} />
              </div>
              <div>
                <div style={{ fontSize: '0.875rem', color: 'var(--primary)', fontWeight: 600, marginBottom: '0.5rem' }}>{feat.tag}</div>
                <h3 style={{ fontSize: '1.5rem', fontWeight: 600, marginBottom: '0.5rem' }}>{feat.title}</h3>
                <p style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>{feat.desc}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </main>
    </div>
  );
}
