'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Shield, AlertCircle, Download, CheckCircle, Copy } from 'lucide-react';
import QRCode from 'qrcode';

type Step = 'loading' | 'scan' | 'verify' | 'backup';

export default function MfaSetupPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('loading');
  const [secret, setSecret] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [code, setCode] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetchSetup();
  }, []);

  async function fetchSetup() {
    try {
      const res = await fetch('/api/auth/mfa-setup');
      if (!res.ok) {
        const data = await res.json();
        if (res.status === 401) {
          router.push('/login');
          return;
        }
        setError(data.error || 'MFA 설정을 불러올 수 없습니다.');
        setStep('scan');
        return;
      }

      const data = await res.json();
      setSecret(data.secret);

      const dataUrl = await QRCode.toDataURL(data.uri, {
        width: 200,
        margin: 2,
        color: { dark: '#000000', light: '#ffffff' },
      });
      setQrDataUrl(dataUrl);
      setStep('scan');
    } catch {
      setError('서버와 통신할 수 없습니다.');
      setStep('scan');
    }
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth/mfa-setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        setBackupCodes(data.backupCodes);
        setStep('backup');
      } else {
        setError(data.error || '코드가 올바르지 않습니다.');
      }
    } catch {
      setError('인증 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  }

  function downloadBackupCodes() {
    const content = [
      'SovereignSMS Admin - MFA 백업 코드',
      '=' .repeat(40),
      '',
      '아래 코드를 안전한 곳에 보관하세요.',
      '각 코드는 1회만 사용할 수 있습니다.',
      '',
      ...backupCodes.map((c, i) => `${(i + 1).toString().padStart(2, '0')}. ${c}`),
      '',
      `생성일: ${new Date().toISOString()}`,
    ].join('\n');

    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sovereignsms-backup-codes.txt';
    a.click();
    URL.revokeObjectURL(url);
  }

  async function copySecret() {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
    }
  }

  return (
    <div className="auth-container">
      <div className="auth-card" style={{ maxWidth: step === 'backup' ? '520px' : '420px' }}>
        <div className="auth-logo">
          <div className="auth-logo-icon">
            <Shield size={24} />
          </div>
          <h1>SovereignSMS</h1>
        </div>

        {step === 'loading' && (
          <div className="loading-center">
            <span className="spinner spinner-lg" />
          </div>
        )}

        {step === 'scan' && (
          <>
            <h2 className="auth-title">MFA 설정</h2>
            <p className="auth-subtitle">인증 앱으로 QR 코드를 스캔하세요</p>

            {error && (
              <div className="auth-error">
                <AlertCircle size={16} style={{ flexShrink: 0, marginTop: '1px' }} />
                <span>{error}</span>
              </div>
            )}

            {qrDataUrl && (
              <div className="mfa-qr-wrapper">
                <img src={qrDataUrl} alt="MFA QR Code" width={200} height={200} />
              </div>
            )}

            <p
              style={{
                fontSize: '12px',
                color: 'var(--text-muted)',
                textAlign: 'center',
                marginBottom: '8px',
              }}
            >
              QR 코드를 스캔할 수 없으면 아래 키를 직접 입력하세요
            </p>

            <div className="mfa-manual-key" style={{ position: 'relative' }}>
              {secret}
              <button
                onClick={copySecret}
                style={{
                  position: 'absolute',
                  right: '8px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: copied ? 'var(--status-success)' : 'var(--text-muted)',
                  padding: '4px',
                }}
              >
                {copied ? <CheckCircle size={14} /> : <Copy size={14} />}
              </button>
            </div>

            <button
              className="btn btn-primary"
              style={{ width: '100%' }}
              onClick={() => setStep('verify')}
            >
              다음
            </button>
          </>
        )}

        {step === 'verify' && (
          <>
            <h2 className="auth-title">코드 확인</h2>
            <p className="auth-subtitle">인증 앱에 표시된 6자리 코드를 입력하세요</p>

            {error && (
              <div className="auth-error">
                <AlertCircle size={16} style={{ flexShrink: 0, marginTop: '1px' }} />
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleVerify}>
              <div className="form-group">
                <input
                  type="text"
                  inputMode="numeric"
                  className="form-input"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000"
                  autoFocus
                  maxLength={6}
                  style={{
                    textAlign: 'center',
                    fontSize: '24px',
                    fontWeight: 700,
                    letterSpacing: '8px',
                  }}
                />
              </div>
              <div style={{ display: 'flex', gap: '12px' }}>
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ flex: 1 }}
                  onClick={() => {
                    setStep('scan');
                    setError('');
                  }}
                >
                  이전
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  style={{ flex: 1 }}
                  disabled={loading || code.length !== 6}
                >
                  {loading && <span className="spinner" />}
                  확인
                </button>
              </div>
            </form>
          </>
        )}

        {step === 'backup' && (
          <>
            <div style={{ textAlign: 'center', marginBottom: '20px' }}>
              <CheckCircle
                size={48}
                style={{ color: 'var(--status-success)', marginBottom: '12px' }}
              />
              <h2 className="auth-title">MFA 활성화 완료</h2>
            </div>

            <div className="auth-warning" style={{ marginBottom: '20px' }}>
              아래 백업 코드를 안전한 곳에 저장하세요. 이 코드는 다시 표시되지 않습니다.
            </div>

            <div className="backup-codes-grid">
              {backupCodes.map((bc, i) => (
                <div key={i} className="backup-code">{bc}</div>
              ))}
            </div>

            <button
              className="btn btn-ghost"
              style={{ width: '100%', marginBottom: '12px' }}
              onClick={downloadBackupCodes}
            >
              <Download size={16} />
              백업 코드 다운로드
            </button>

            <button
              className="btn btn-primary"
              style={{ width: '100%' }}
              onClick={() => router.push('/')}
            >
              대시보드로 이동
            </button>
          </>
        )}
      </div>
    </div>
  );
}
