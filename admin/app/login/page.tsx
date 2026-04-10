'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Shield, AlertCircle, Clock } from 'lucide-react';
import { z } from 'zod';

const loginSchema = z.object({
  email: z.string().email('유효한 이메일을 입력하세요.'),
  password: z.string().min(1, '비밀번호를 입력하세요.'),
});

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [locked, setLocked] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setWarning('');

    const parsed = loginSchema.safeParse({ email, password });
    if (!parsed.success) {
      const errors = parsed.error.flatten().fieldErrors;
      setError(Object.values(errors).flat()[0] || '입력값을 확인하세요.');
      return;
    }

    setLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (res.status === 429) {
        setLocked(true);
        setError(data.error);
      } else if (res.status === 403) {
        if (data.error?.includes('잠겨')) {
          setLocked(true);
        }
        setError(data.error);
      } else if (!res.ok) {
        setError(data.error || '로그인에 실패했습니다.');
        if (data.remainingAttempts !== undefined && data.remainingAttempts <= 3) {
          setWarning(`남은 시도 횟수: ${data.remainingAttempts}회`);
        }
      } else if (data.requireMfa) {
        router.push('/mfa-verify');
      } else if (data.success) {
        router.push('/');
      }
    } catch {
      setError('서버와 통신할 수 없습니다.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-container">
      <div className="auth-card">
        <div className="auth-logo">
          <div className="auth-logo-icon">
            <Shield size={24} />
          </div>
          <h1>SovereignSMS</h1>
        </div>

        <h2 className="auth-title">관리자 로그인</h2>
        <p className="auth-subtitle">관리자 계정으로 로그인하세요</p>

        {locked && (
          <div className="auth-error">
            <Clock size={16} style={{ flexShrink: 0, marginTop: '1px' }} />
            <span>계정이 잠겨 있습니다. 15분 후 다시 시도하세요.</span>
          </div>
        )}

        {error && !locked && (
          <div className="auth-error">
            <AlertCircle size={16} style={{ flexShrink: 0, marginTop: '1px' }} />
            <span>{error}</span>
          </div>
        )}

        {warning && (
          <div className="auth-warning">{warning}</div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">이메일</label>
            <input
              type="email"
              className="form-input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@sovereignsms.com"
              autoFocus
              disabled={locked}
            />
          </div>
          <div className="form-group">
            <label className="form-label">비밀번호</label>
            <input
              type="password"
              className="form-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="비밀번호를 입력하세요"
              disabled={locked}
            />
          </div>
          <button
            type="submit"
            className="btn btn-primary"
            style={{ width: '100%', marginTop: '8px' }}
            disabled={loading || locked}
          >
            {loading && <span className="spinner" />}
            로그인
          </button>
        </form>
      </div>
    </div>
  );
}
