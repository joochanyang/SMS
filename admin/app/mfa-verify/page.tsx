'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Shield, AlertCircle, KeyRound } from 'lucide-react';

export default function MfaVerifyPage() {
  const router = useRouter();
  const [code, setCode] = useState(['', '', '', '', '', '']);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [useBackup, setUseBackup] = useState(false);
  const [backupCode, setBackupCode] = useState('');
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (!useBackup) {
      inputRefs.current[0]?.focus();
    }
  }, [useBackup]);

  async function submitCode(codeStr: string) {
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth/mfa-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: codeStr }),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        router.push('/');
      } else {
        setError(data.error || '코드가 올바르지 않습니다.');
        if (!useBackup) {
          setCode(['', '', '', '', '', '']);
          inputRefs.current[0]?.focus();
        }
      }
    } catch {
      setError('인증 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  }

  function handleDigitChange(index: number, value: string) {
    if (!/^\d*$/.test(value)) return;

    const newCode = [...code];
    newCode[index] = value.slice(-1);
    setCode(newCode);

    if (value && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }

    const fullCode = newCode.join('');
    if (fullCode.length === 6) {
      submitCode(fullCode);
    }
  }

  function handleKeyDown(index: number, e: React.KeyboardEvent) {
    if (e.key === 'Backspace' && !code[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  }

  function handlePaste(e: React.ClipboardEvent) {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (pasted.length === 6) {
      setCode(pasted.split(''));
      submitCode(pasted);
    }
  }

  function handleBackupSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (backupCode.length >= 6) {
      submitCode(backupCode.toUpperCase());
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

        <h2 className="auth-title">2단계 인증</h2>
        <p className="auth-subtitle">
          {useBackup
            ? '백업 코드를 입력하세요'
            : '인증 앱에서 6자리 코드를 입력하세요'}
        </p>

        {error && (
          <div className="auth-error">
            <AlertCircle size={16} style={{ flexShrink: 0, marginTop: '1px' }} />
            <span>{error}</span>
          </div>
        )}

        {!useBackup ? (
          <>
            <div className="mfa-code-group" onPaste={handlePaste}>
              {code.map((digit, i) => (
                <input
                  key={i}
                  ref={(el) => { inputRefs.current[i] = el; }}
                  type="text"
                  inputMode="numeric"
                  className="mfa-code-input"
                  value={digit}
                  onChange={(e) => handleDigitChange(i, e.target.value)}
                  onKeyDown={(e) => handleKeyDown(i, e)}
                  maxLength={1}
                  disabled={loading}
                  autoComplete="one-time-code"
                />
              ))}
            </div>

            {loading && (
              <div className="loading-center" style={{ padding: '16px' }}>
                <span className="spinner" />
              </div>
            )}
          </>
        ) : (
          <form onSubmit={handleBackupSubmit}>
            <div className="form-group">
              <label className="form-label">백업 코드</label>
              <input
                type="text"
                className="form-input"
                value={backupCode}
                onChange={(e) => setBackupCode(e.target.value.toUpperCase())}
                placeholder="XXXXXXXX"
                autoFocus
                disabled={loading}
                style={{ fontFamily: "'JetBrains Mono', monospace", textAlign: 'center', letterSpacing: '2px' }}
              />
            </div>
            <button
              type="submit"
              className="btn btn-primary"
              style={{ width: '100%' }}
              disabled={loading || backupCode.length < 6}
            >
              {loading && <span className="spinner" />}
              인증
            </button>
          </form>
        )}

        <div style={{ textAlign: 'center', marginTop: '20px' }}>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setUseBackup(!useBackup);
              setError('');
            }}
            style={{ gap: '6px' }}
          >
            <KeyRound size={14} />
            {useBackup ? 'OTP 코드 사용' : '백업 코드 사용'}
          </button>
        </div>
      </div>
    </div>
  );
}
