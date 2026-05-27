'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Radio, CheckCircle, XCircle, RefreshCw, Send, Zap } from 'lucide-react';
import ConfirmModal from '@/components/confirm-modal';
import SudoModal from '@/components/sudo-modal';
import { hasPermission } from '@/lib/rbac';
import { useAdminInfo } from '@/lib/use-admin-info';

interface ProviderInfo {
  name: string;
  isConfigured: boolean;
  isActive: boolean;
  enabled: boolean;
  maxBatchSize: number;
}

interface TestResult {
  success: boolean;
  balance?: number;
  currency?: string;
  remainingCount?: number | null;
  error?: string;
}

const PROVIDER_LABELS: Record<string, string> = {
  infobip: 'Infobip',
  smsto: 'SMS.to',
  txg: 'TXG-TEL',
};

const PROVIDER_DESCRIPTIONS: Record<string, string> = {
  infobip: '글로벌 CPaaS — 트라이얼 무료 크레딧 지원, 안정적인 DLR 웹훅',
  smsto: '저가형 글로벌 SMS — 건당 ~$0.009, DLR 웹훅 + API 폴링 지원',
  txg: 'TXG-TEL SMPP — 전용 워커가 submit_sm 발송과 in-band DLR 수신 처리',
};

type SendTestResult = {
  success?: boolean;
  result?: {
    messageId?: string;
    error?: string;
  };
  error?: string;
  requireSudo?: boolean;
};

export default function SmsProvidersPage() {
  const router = useRouter();
  const admin = useAdminInfo();
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [killSwitch, setKillSwitch] = useState(false);

  // 연결 테스트 상태
  const [testResults, setTestResults] = useState<Record<string, TestResult>>({});
  const [testingProvider, setTestingProvider] = useState('');

  // 활성 라인 변경 모달
  const [switchModal, setSwitchModal] = useState(false);
  const [switchTarget, setSwitchTarget] = useState('');
  const [switchReason, setSwitchReason] = useState('');
  const [switchLoading, setSwitchLoading] = useState(false);

  // 테스트 발송 모달
  const [sendModal, setSendModal] = useState(false);
  const [sendProvider, setSendProvider] = useState('');
  const [sendTo, setSendTo] = useState('');
  const [sendMessage, setSendMessage] = useState('SovereignSMS 테스트 발송입니다.');
  const [sendLoading, setSendLoading] = useState(false);
  const [sendResult, setSendResult] = useState<SendTestResult | null>(null);
  const [showSudoModal, setShowSudoModal] = useState(false);
  const [sudoRetryAction, setSudoRetryAction] = useState<'switch' | 'send-test' | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      // killSwitch는 settings 페이지처럼 화면 표시에 필요해서 session 호출 유지
      const [sessionRes, providersRes] = await Promise.all([
        fetch('/api/auth/session'),
        fetch('/api/sms-providers'),
      ]);

      if (sessionRes.status === 401) { router.push('/login'); return; }
      if (sessionRes.ok) {
        const sessionData = await sessionRes.json();
        setKillSwitch(sessionData.killSwitch ?? false);
      }

      if (providersRes.ok) {
        const data = await providersRes.json();
        setProviders(data.providers || []);
      }
    } catch (err) {
      console.error('데이터 로딩 실패:', err);
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // 연결 테스트
  async function handleTest(providerName: string) {
    setTestingProvider(providerName);
    try {
      const res = await fetch('/api/sms-providers/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: providerName }),
      });
      const data = await res.json();
      setTestResults((prev) => ({ ...prev, [providerName]: data }));
    } catch {
      setTestResults((prev) => ({
        ...prev,
        [providerName]: { success: false, error: '연결 실패' },
      }));
    } finally {
      setTestingProvider('');
    }
  }

  // 활성 라인 변경
  async function handleSwitch() {
    if (!switchTarget || !switchReason) return;
    setSwitchLoading(true);
    try {
      const res = await fetch('/api/sms-providers', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: switchTarget, reason: switchReason }),
      });
      if (res.ok) {
        setSwitchModal(false);
        setSwitchReason('');
        await fetchData();
      } else {
        const data = await res.json().catch(() => ({}));
        if (res.status === 403 && data.requireSudo) {
          setSudoRetryAction('switch');
          setShowSudoModal(true);
        } else {
          alert(data.error || '변경 실패');
        }
      }
    } catch {
      alert('요청 처리 중 오류가 발생했습니다.');
    } finally {
      setSwitchLoading(false);
    }
  }

  // 테스트 발송
  async function handleSendTest() {
    if (!sendProvider || !sendTo || !sendMessage) return;
    setSendLoading(true);
    setSendResult(null);
    try {
      const res = await fetch('/api/sms-providers/send-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: sendProvider, to: sendTo, message: sendMessage }),
      });
      const data = await res.json();
      if (res.status === 403 && data.requireSudo) {
        setSudoRetryAction('send-test');
        setShowSudoModal(true);
      } else {
        setSendResult(data);
      }
    } catch {
      setSendResult({ success: false, error: '발송 실패' });
    } finally {
      setSendLoading(false);
    }
  }

  if (!admin) return null;

  const canReadProviderSettings = hasPermission(admin.role, 'setting:read');
  const canUpdateProviderSettings = hasPermission(admin.role, 'setting:update');
  const canSendProviderTest = admin.role === 'SUPER_ADMIN';

  return (
    <>
        {loading ? (
          <div className="loading-container">
            <div className="spinner" />
            <p>로딩 중...</p>
          </div>
        ) : (
          <div className="content-grid">
            {/* 프로바이더 카드 */}
            {providers.map((p) => (
              <div
                key={p.name}
                className={`card provider-card ${p.isActive ? 'provider-active' : ''}`}
              >
                <div className="provider-card-header">
                  <div className="provider-card-title">
                    <Radio size={20} />
                    <h3>{PROVIDER_LABELS[p.name] || p.name}</h3>
                    {p.isActive && (
                      <span className="badge badge-success">활성</span>
                    )}
                  </div>
                  <div className="provider-card-status">
                    {p.isConfigured ? (
                      <span className="badge badge-info">
                        <CheckCircle size={12} /> 설정됨
                      </span>
                    ) : (
                      <span className="badge badge-warning">
                        <XCircle size={12} /> 미설정
                      </span>
                    )}
                  </div>
                </div>

                <p className="provider-description">
                  {PROVIDER_DESCRIPTIONS[p.name] || ''}
                </p>

                <div className="provider-meta">
                  <span>최대 배치: {p.maxBatchSize}건</span>
                </div>

                {/* 연결 테스트 결과 */}
                {testResults[p.name] && (
                  <div className={`provider-test-result ${testResults[p.name].success ? 'success' : 'error'}`}>
                    {testResults[p.name].success ? (
                      <span>
                        <CheckCircle size={14} /> 연결 성공 — 잔액: {testResults[p.name].balance?.toFixed(4)} {testResults[p.name].currency}
                        {testResults[p.name].remainingCount != null && (
                          <> (≈ {testResults[p.name].remainingCount!.toLocaleString()}건)</>
                        )}
                      </span>
                    ) : (
                      <span>
                        <XCircle size={14} /> {testResults[p.name].error}
                      </span>
                    )}
                  </div>
                )}

                {/* 버튼 영역 */}
                <div className="provider-actions">
                  <button
                    className="btn btn-outline btn-sm"
                    onClick={() => handleTest(p.name)}
                    disabled={!canReadProviderSettings || !p.isConfigured || testingProvider === p.name}
                  >
                    <RefreshCw size={14} className={testingProvider === p.name ? 'spin' : ''} />
                    {testingProvider === p.name ? '테스트 중...' : '연결 테스트'}
                  </button>

                  <button
                    className="btn btn-outline btn-sm"
                    onClick={() => {
                      setSendProvider(p.name);
                      setSendResult(null);
                      setSendModal(true);
                    }}
                    disabled={!canSendProviderTest || !p.isConfigured}
                  >
                    <Send size={14} />
                    테스트 발송
                  </button>

                  {!p.isActive && p.isConfigured && canUpdateProviderSettings && (
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => {
                        setSwitchTarget(p.name);
                        setSwitchModal(true);
                      }}
                    >
                      <Zap size={14} />
                      활성화
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

      {/* 활성 라인 변경 모달 */}
      <ConfirmModal
        isOpen={switchModal}
        title="SMS 라인 변경"
        message={`활성 프로바이더를 "${PROVIDER_LABELS[switchTarget] || switchTarget}"(으)로 변경합니다. 이후 모든 캠페인 발송이 이 프로바이더를 통해 전송됩니다.`}
        confirmText="변경"
        onConfirm={handleSwitch}
        onClose={() => { setSwitchModal(false); setSwitchReason(''); }}
        loading={switchLoading}
      >
        <div className="form-group" style={{ marginTop: '1rem' }}>
          <label className="form-label">변경 사유</label>
          <input
            type="text"
            className="form-input"
            placeholder="변경 사유를 입력하세요 (5자 이상)"
            value={switchReason}
            onChange={(e) => setSwitchReason(e.target.value)}
          />
        </div>
      </ConfirmModal>

      {/* 테스트 발송 모달 */}
      {sendModal && (
        <div className="modal-overlay" onClick={() => setSendModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>테스트 발송 — {PROVIDER_LABELS[sendProvider] || sendProvider}</h3>
              <button className="modal-close" onClick={() => setSendModal(false)}>×</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">수신번호 (E.164)</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="+821012345678"
                  value={sendTo}
                  onChange={(e) => setSendTo(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label className="form-label">메시지</label>
                <textarea
                  className="form-input"
                  rows={3}
                  value={sendMessage}
                  onChange={(e) => setSendMessage(e.target.value)}
                />
              </div>

              {sendResult && (
                <div className={`provider-test-result ${sendResult.success ? 'success' : 'error'}`}>
                  {sendResult.success ? (
                    <span><CheckCircle size={14} /> 발송 성공 (messageId: {sendResult.result?.messageId || '-'})</span>
                  ) : (
                    <span><XCircle size={14} /> {sendResult.result?.error || sendResult.error || '발송 실패'}</span>
                  )}
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setSendModal(false)}>닫기</button>
              <button
                className="btn btn-primary"
                onClick={handleSendTest}
                disabled={sendLoading || !sendTo}
              >
                {sendLoading ? '발송 중...' : '발송'}
              </button>
            </div>
          </div>
        </div>
      )}

      <SudoModal
        isOpen={showSudoModal}
        onClose={() => {
          setShowSudoModal(false);
          setSudoRetryAction(null);
        }}
        onSuccess={async () => {
          setShowSudoModal(false);
          if (sudoRetryAction === 'switch') {
            await handleSwitch();
          } else if (sudoRetryAction === 'send-test') {
            await handleSendTest();
          }
          setSudoRetryAction(null);
        }}
      />

      <style jsx>{`
        .provider-card {
          padding: 1.5rem;
          border: 1px solid var(--border-color, rgba(255,255,255,0.08));
          border-radius: 12px;
          transition: border-color 0.2s;
        }
        .provider-card.provider-active {
          border-color: var(--success-color, #00c48c);
          box-shadow: 0 0 0 1px var(--success-color, #00c48c);
        }
        .provider-card-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 0.75rem;
        }
        .provider-card-title {
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }
        .provider-card-title h3 {
          margin: 0;
          font-size: 1.1rem;
        }
        .provider-description {
          color: var(--text-secondary, rgba(255,255,255,0.6));
          font-size: 0.85rem;
          margin: 0.5rem 0 1rem;
        }
        .provider-meta {
          font-size: 0.8rem;
          color: var(--text-secondary, rgba(255,255,255,0.5));
          margin-bottom: 1rem;
        }
        .provider-test-result {
          padding: 0.6rem 0.8rem;
          border-radius: 8px;
          font-size: 0.85rem;
          margin-bottom: 1rem;
          display: flex;
          align-items: center;
          gap: 0.4rem;
        }
        .provider-test-result.success {
          background: rgba(0, 196, 140, 0.1);
          color: var(--success-color, #00c48c);
          border: 1px solid rgba(0, 196, 140, 0.2);
        }
        .provider-test-result.error {
          background: rgba(255, 71, 87, 0.1);
          color: var(--error-color, #ff4757);
          border: 1px solid rgba(255, 71, 87, 0.2);
        }
        .provider-actions {
          display: flex;
          gap: 0.5rem;
          flex-wrap: wrap;
        }
        .content-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(400px, 1fr));
          gap: 1.5rem;
          padding: 1.5rem;
        }
        .spin {
          animation: spin 1s linear infinite;
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </>
  );
}
