'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { ShieldAlert, Globe2 } from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const res = await signIn('credentials', {
      redirect: false,
      username,
      password,
    });

    if (res?.error) {
      setError('아이디 또는 비밀번호가 올바르지 않습니다.');
    } else {
      router.push('/dashboard/sms-send');
    }
  };

  const inputStyle = {
    width: '100%',
    backgroundColor: 'rgba(15, 23, 42, 0.8)',
    border: '1px solid var(--border)',
    borderRadius: '8px',
    padding: '0.75rem 1rem',
    color: 'var(--text-main)',
    outline: 'none',
    transition: 'border-color 0.2s ease',
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
      <motion.div
        className="glass-card"
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        style={{ width: '100%', maxWidth: '400px', padding: '3rem 2rem' }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: '2rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 700, fontSize: '1.5rem', marginBottom: '0.5rem' }}>
            <Globe2 color="var(--primary)" size={28} />
            <span>Sovereign<span style={{ color: 'var(--primary)' }}>SMS</span></span>
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>계정에 로그인하세요</p>
        </div>

        {error && (
          <div style={{
            backgroundColor: 'rgba(239, 68, 68, 0.1)', color: '#ef4444',
            padding: '0.75rem 1rem', borderRadius: '8px', marginBottom: '1.5rem',
            fontSize: '0.875rem', display: 'flex', alignItems: 'center', gap: '0.5rem'
          }}>
            <ShieldAlert size={16} />
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <label style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--text-secondary)' }}>아이디</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="아이디를 입력하세요"
              required
              style={inputStyle}
              onFocus={(e) => e.target.style.borderColor = 'var(--primary)'}
              onBlur={(e) => e.target.style.borderColor = 'var(--border)'}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <label style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--text-secondary)' }}>비밀번호</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              style={inputStyle}
              onFocus={(e) => e.target.style.borderColor = 'var(--primary)'}
              onBlur={(e) => e.target.style.borderColor = 'var(--border)'}
            />
          </div>

          <button type="submit" className="btn-primary" style={{ width: '100%', marginTop: '0.5rem', padding: '0.875rem' }}>
            로그인
          </button>
        </form>

        <p style={{ textAlign: 'center', marginTop: '1.5rem', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
          계정이 없으신가요?{' '}
          <a href="/register" style={{ color: 'var(--primary)', textDecoration: 'none' }}>회원가입</a>
        </p>
      </motion.div>
    </div>
  );
}
