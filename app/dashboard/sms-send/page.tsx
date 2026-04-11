'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Papa from 'papaparse';
import Link from 'next/link';
import { Send, Upload, Info, Smartphone, Users, AlertTriangle, CheckCircle, XCircle, Loader, ChevronDown, ChevronUp, X as XIcon } from 'lucide-react';

const DEFAULT_BATCH_SIZE = 200;

// GSM-7 basic character set for client-side detection
const GSM7_CHARS = new Set(
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZ' +
  'ÄÖÑÜabcdefghijklmnopqrstuvwxyzäöñüà§ÆæßÉ{|}~[\\]^€'
);

function isGsm7(text: string): boolean {
  for (const ch of text) {
    if (!GSM7_CHARS.has(ch)) return false;
  }
  return true;
}

function getSmsInfo(text: string) {
  const gsm7 = isGsm7(text);
  const charCount = text.length;
  const singleMax = gsm7 ? 160 : 70;
  const concatMax = gsm7 ? 153 : 67;
  const parts = charCount <= singleMax ? (charCount > 0 ? 1 : 0) : Math.ceil(charCount / concatMax);
  return {
    encoding: gsm7 ? 'GSM-7' : 'UCS-2' as const,
    charCount,
    maxChars: singleMax,
    parts,
    remaining: singleMax - charCount,
  };
}

function isValidPhone(raw: string): boolean {
  const cleaned = raw.replace(/[\s\-().]/g, '');
  if (/^\+\d{7,15}$/.test(cleaned)) return true;
  if (/^\d{7,15}$/.test(cleaned)) return true;
  return false;
}

type CampaignProgress = {
  id: string;
  status: string;
  processedCount: number;
  totalRecipients: number;
  failedCount: number;
  deliveredCount: number;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export default function SmsSendPage() {
  const [activeTab, setActiveTab] = useState<'single' | 'bulk'>('single');
  const [message, setMessage] = useState('');
  const [recipients, setRecipients] = useState('');
  const [csvFilename, setCsvFilename] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [progress, setProgress] = useState<CampaignProgress | null>(null);
  const [completedCampaign, setCompletedCampaign] = useState<CampaignProgress | null>(null);
  const [showInvalidNumbers, setShowInvalidNumbers] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const activeCampaignIdRef = useRef<string | null>(null);
  const cancelledRef = useRef(false);

  // 유저 정보 (크레딧 잔액, 건당 단가)
  const [creditBalance, setCreditBalance] = useState<number>(0);
  const [costPerMessage, setCostPerMessage] = useState<number>(14);

  useEffect(() => {
    fetch('/api/dashboard/stats')
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (data?.overview) {
          setCreditBalance(Number(data.overview.creditBalance ?? 0));
          setCostPerMessage(Number(data.overview.costPerMessage ?? 14));
        }
      })
      .catch(() => {});
  }, []);

  const smsInfo = useMemo(() => getSmsInfo(message), [message]);

  const parsedRecipients = useMemo(() => {
    if (!recipients.trim()) return [];
    return Array.from(
      new Set(
        recipients
          .split(/[\n,]/)
          .map((r) => r.trim())
          .filter(Boolean)
      )
    );
  }, [recipients]);

  const validRecipients = useMemo(() => parsedRecipients.filter(isValidPhone), [parsedRecipients]);
  const invalidRecipients = useMemo(() => parsedRecipients.filter((r) => !isValidPhone(r)), [parsedRecipients]);

  const estimatedTotalCost = validRecipients.length * costPerMessage;
  const availableSendCount = costPerMessage > 0 ? Math.floor(creditBalance / costPerMessage) : 0;
  const isOverLimit = smsInfo.charCount > smsInfo.maxChars;

  const parseCsvFile = (file: File) => {
    setStatusError(null);
    Papa.parse(file, {
      skipEmptyLines: true,
      complete: (result) => {
        const values: string[] = [];
        for (const row of result.data as Array<string[] | string>) {
          if (Array.isArray(row)) {
            for (const cell of row) {
              if (typeof cell === 'string' && cell.trim()) values.push(cell.trim());
            }
          } else if (typeof row === 'string' && row.trim()) {
            values.push(row.trim());
          }
        }
        setRecipients(values.join('\n'));
        setCsvFilename(file.name);
        setStatusMessage(`CSV 파싱 완료: ${values.length}개 항목 로드됨`);
      },
      error: () => setStatusError('CSV 파싱 실패. 파일 형식을 확인하세요.'),
    });
  };

  const handleCancelCampaign = async () => {
    const cid = activeCampaignIdRef.current;
    if (!cid) return;
    cancelledRef.current = true;
    try {
      await fetch(`/api/sms/campaign/${cid}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel' }),
      });
    } catch {
      // 취소 요청 실패 시에도 클라이언트 루프는 중단
    }
  };

  const processCampaignLoop = async (campaignId: string) => {
    for (let i = 0; i < 1000; i++) {
      if (cancelledRef.current) {
        const detailRes = await fetch(`/api/sms/campaign/${campaignId}`);
        const detailData = await detailRes.json();
        return detailData.campaign;
      }
      const processRes = await fetch(`/api/sms/campaign/${campaignId}/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batchSize: DEFAULT_BATCH_SIZE }),
      });
      const processData = await processRes.json();

      if (processRes.status === 429) {
        const waitMs = typeof processData.retryAfterMs === 'number' ? processData.retryAfterMs : 1000;
        await sleep(Math.max(500, waitMs));
        continue;
      }

      if (!processRes.ok && processRes.status !== 502) {
        throw new Error(processData.error || '캠페인 처리 중 오류가 발생했습니다.');
      }

      const detailRes = await fetch(`/api/sms/campaign/${campaignId}`);
      const detailData = await detailRes.json();
      if (!detailRes.ok) throw new Error(detailData.error || '캠페인 상태 조회 실패');

      const campaign = detailData.campaign;
      setProgress({
        id: campaign.id,
        status: campaign.status,
        processedCount: campaign.processedCount,
        totalRecipients: campaign.totalRecipients,
        failedCount: campaign.failedCount,
        deliveredCount: campaign.deliveredCount,
      });

      if (['COMPLETED', 'CANCELLED', 'FAILED'].includes(campaign.status)) return campaign;
      await sleep(1000);
    }
    throw new Error('자동 처리 루프가 제한을 초과했습니다.');
  };

  const handleSendClick = () => {
    setStatusMessage(null);
    setStatusError(null);

    if (!message.trim()) {
      setStatusError('메시지 내용을 입력하세요.');
      return;
    }
    if (validRecipients.length === 0) {
      setStatusError('유효한 수신 번호가 없습니다. 번호를 확인하세요.');
      return;
    }
    setShowConfirmModal(true);
  };

  const handleSend = async () => {
    setShowConfirmModal(false);
    setStatusMessage(null);
    setStatusError(null);
    setProgress(null);
    setCompletedCampaign(null);
    cancelledRef.current = false;
    activeCampaignIdRef.current = null;

    try {
      setIsSending(true);
      const createRes = await fetch('/api/sms/campaign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipients: validRecipients,
          message,
        }),
      });
      const createData = await createRes.json();
      if (!createRes.ok) {
        setStatusError(createData.error || '캠페인 생성에 실패했습니다.');
        return;
      }

      const campaignId = createData.campaignId as string;
      activeCampaignIdRef.current = campaignId;
      setStatusMessage(`캠페인 생성 완료. 자동 발송을 시작합니다. (ID: ${campaignId})`);
      const finalCampaign = await processCampaignLoop(campaignId);

      const completed: CampaignProgress = {
        id: finalCampaign.id,
        status: finalCampaign.status,
        processedCount: finalCampaign.processedCount,
        totalRecipients: finalCampaign.totalRecipients,
        failedCount: finalCampaign.failedCount,
        deliveredCount: finalCampaign.deliveredCount,
      };
      setCompletedCampaign(completed);
      setProgress(null);
      setStatusMessage(null);

      // 발송 후 크레딧 잔액 갱신
      setCreditBalance((prev) => Math.max(0, prev - estimatedTotalCost));

      if (finalCampaign.failedCount > 0) {
        setStatusError('일부 건이 실패했습니다. 히스토리에서 상세 내역을 확인하세요.');
      }
    } catch (e: unknown) {
      setStatusError(e instanceof Error ? e.message : '서버 통신 중 오류가 발생했습니다.');
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div style={{ display: 'flex', gap: '2rem', height: '100%' }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        <div className="glass-card" style={{ padding: '1.5rem' }}>
          <div style={{ display: 'flex', gap: '1rem', marginBottom: '2rem', borderBottom: '1px solid var(--border)', paddingBottom: '1rem' }}>
            <button onClick={() => setActiveTab('single')} style={{ padding: '0.5rem 1rem', color: activeTab === 'single' ? 'var(--primary)' : 'var(--text-secondary)', fontWeight: 600, borderBottom: activeTab === 'single' ? '2px solid var(--primary)' : 'none' }}>
              개별 발송
            </button>
            <button onClick={() => setActiveTab('bulk')} style={{ padding: '0.5rem 1rem', color: activeTab === 'bulk' ? 'var(--primary)' : 'var(--text-secondary)', fontWeight: 600, borderBottom: activeTab === 'bulk' ? '2px solid var(--primary)' : 'none' }}>
              대량 발송 (CSV)
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            {/* 발송 정보 카드 (캠페인 이름 대신) */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem' }}>
              <div style={{ padding: '0.75rem 1rem', borderRadius: '8px', backgroundColor: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.15)' }}>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>발송 건수</div>
                <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--primary)' }}>{validRecipients.length}건</div>
              </div>
              <div style={{ padding: '0.75rem 1rem', borderRadius: '8px', backgroundColor: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.15)' }}>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>잔여 발송 가능</div>
                <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#6ee7b7' }}>{availableSendCount.toLocaleString('ko-KR')}건</div>
              </div>
              <div style={{ padding: '0.75rem 1rem', borderRadius: '8px', backgroundColor: 'rgba(249,115,22,0.08)', border: '1px solid rgba(249,115,22,0.15)' }}>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>크레딧 잔액</div>
                <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#fb923c' }}>₩{creditBalance.toLocaleString('ko-KR')}</div>
              </div>
            </div>

            {/* 수신 번호 (먼저) */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                {activeTab === 'single' ? <Smartphone size={16} /> : <Users size={16} />}
                {activeTab === 'single' ? '수신 번호' : 'CSV 대량 발송'}
              </label>

              {activeTab === 'single' ? (
                <textarea placeholder="번호를 입력하세요 (예: +821012345678), 쉼표 또는 줄바꿈으로 구분" value={recipients} onChange={(e) => setRecipients(e.target.value)} disabled={isSending} style={{ width: '100%', minHeight: '120px', backgroundColor: 'rgba(2, 6, 23, 0.5)', border: '1px solid var(--border)', borderRadius: '8px', padding: '1rem', color: 'var(--text-main)', outline: 'none', resize: 'vertical', opacity: isSending ? 0.6 : 1 }} />
              ) : (
                <label
                  onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); if (!isSending) setIsDragOver(true); }}
                  onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragOver(false); }}
                  onDrop={(e) => {
                    e.preventDefault(); e.stopPropagation(); setIsDragOver(false);
                    if (isSending) return;
                    const file = e.dataTransfer.files?.[0];
                    if (file && (file.name.endsWith('.csv') || file.type === 'text/csv')) parseCsvFile(file);
                    else setStatusError('CSV 파일만 업로드할 수 있습니다.');
                  }}
                  style={{
                    border: `2px dashed ${isDragOver ? 'var(--primary)' : 'var(--border)'}`,
                    borderRadius: '12px', padding: '2rem', textAlign: 'center',
                    backgroundColor: isDragOver ? 'rgba(59,130,246,0.08)' : 'rgba(2, 6, 23, 0.3)',
                    cursor: isSending ? 'not-allowed' : 'pointer', display: 'block',
                    opacity: isSending ? 0.6 : 1, transition: 'border-color 0.2s, background-color 0.2s',
                  }}
                >
                  <input type="file" accept=".csv,text/csv" style={{ display: 'none' }} disabled={isSending} onChange={(e) => { const file = e.target.files?.[0]; if (file) parseCsvFile(file); }} />
                  <Upload size={32} color={isDragOver ? 'var(--primary)' : 'var(--text-secondary)'} style={{ marginBottom: '1rem' }} />
                  <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>{isDragOver ? '여기에 놓으세요' : 'CSV 파일 선택 또는 드래그앤드롭'}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{csvFilename ? `선택됨: ${csvFilename}` : '전화번호가 포함된 CSV 파일 업로드'}</div>
                </label>
              )}
              {parsedRecipients.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.5rem' }}>
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <span style={{ padding: '0.25rem 0.75rem', borderRadius: '999px', fontSize: '0.75rem', fontWeight: 600, backgroundColor: 'rgba(16,185,129,0.1)', color: '#6ee7b7' }}>
                      유효: {validRecipients.length}개
                    </span>
                    {invalidRecipients.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setShowInvalidNumbers((v) => !v)}
                        style={{ padding: '0.25rem 0.75rem', borderRadius: '999px', fontSize: '0.75rem', fontWeight: 600, backgroundColor: 'rgba(239,68,68,0.1)', color: '#fca5a5', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.35rem', border: 'none' }}
                      >
                        무효: {invalidRecipients.length}개
                        {showInvalidNumbers ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                      </button>
                    )}
                    <span style={{ padding: '0.25rem 0.75rem', borderRadius: '999px', fontSize: '0.75rem', fontWeight: 600, backgroundColor: 'rgba(59,130,246,0.1)', color: '#93c5fd' }}>
                      총: {parsedRecipients.length}개
                    </span>
                  </div>
                  {showInvalidNumbers && invalidRecipients.length > 0 && (
                    <div style={{ padding: '0.75rem 1rem', borderRadius: '8px', backgroundColor: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.15)', fontSize: '0.75rem', color: '#fca5a5', maxHeight: '120px', overflowY: 'auto' }}>
                      <div style={{ marginBottom: '0.5rem', fontWeight: 600 }}>유효하지 않은 번호 목록:</div>
                      {invalidRecipients.map((num, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', padding: '0.15rem 0' }}>
                          <XCircle size={11} /> {num}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* 메시지 내용 (수신번호 다음) */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>메시지 내용</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.75rem' }}>
                  <span style={{ color: 'var(--text-secondary)', backgroundColor: 'rgba(255,255,255,0.05)', padding: '0.2rem 0.5rem', borderRadius: '4px' }}>
                    {smsInfo.encoding}
                  </span>
                  <span style={{ color: isOverLimit ? '#ef4444' : 'var(--primary)', fontWeight: 600 }}>
                    {smsInfo.charCount} / {smsInfo.maxChars}
                  </span>
                  <span style={{ color: isOverLimit ? '#ef4444' : '#6ee7b7', fontWeight: 600, fontSize: '0.7rem' }}>
                    (남은 글자: {smsInfo.remaining > 0 ? smsInfo.remaining : 0}자)
                  </span>
                  {isOverLimit && (
                    <span style={{ color: '#ef4444', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                      <AlertTriangle size={12} />
                      초과
                    </span>
                  )}
                </div>
              </div>
              <textarea placeholder="메시지를 입력하세요..." value={message} onChange={(e) => setMessage(e.target.value)} disabled={isSending} style={{ width: '100%', minHeight: '180px', backgroundColor: 'rgba(2, 6, 23, 0.5)', border: `1px solid ${isOverLimit ? '#f59e0b' : 'var(--border)'}`, borderRadius: '8px', padding: '1rem', color: 'var(--text-main)', outline: 'none', resize: 'vertical', opacity: isSending ? 0.6 : 1 }} />
              {isOverLimit && (
                <div style={{ fontSize: '0.75rem', color: '#ef4444', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <AlertTriangle size={14} />
                  {smsInfo.encoding} 기준 최대 {smsInfo.maxChars}자입니다. 메시지를 줄여주세요.
                </div>
              )}
            </div>

            {statusError && <div style={{ marginTop: '0.5rem', padding: '0.75rem 1rem', borderRadius: '8px', backgroundColor: 'rgba(239,68,68,0.08)', color: '#fca5a5', fontSize: '0.8rem' }}>{statusError}</div>}
            {statusMessage && <div style={{ marginTop: '0.5rem', padding: '0.75rem 1rem', borderRadius: '8px', backgroundColor: 'rgba(16,185,129,0.08)', color: '#6ee7b7', fontSize: '0.8rem' }}>{statusMessage}</div>}

            {/* 발송 진행률 프로그레스 바 */}
            {progress && (() => {
              const percent = progress.totalRecipients > 0 ? Math.round((progress.processedCount / progress.totalRecipients) * 100) : 0;
              const statusColor = progress.status === 'COMPLETED' ? '#10b981' : progress.status === 'FAILED' ? '#ef4444' : 'var(--primary)';
              const statusLabel = progress.status === 'COMPLETED' ? '완료' : progress.status === 'FAILED' ? '실패' : progress.status === 'CANCELLED' ? '취소됨' : '발송 중';
              return (
                <div style={{ marginTop: '0.5rem', padding: '1rem', borderRadius: '8px', backgroundColor: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.15)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                    <span style={{ fontSize: '0.8rem', color: statusColor, fontWeight: 600 }}>{statusLabel}</span>
                    <span style={{ fontSize: '0.8rem', color: '#93c5fd', fontWeight: 600 }}>{percent}%</span>
                  </div>
                  <div style={{ width: '100%', height: '8px', backgroundColor: 'rgba(59,130,246,0.15)', borderRadius: '4px', overflow: 'hidden' }}>
                    <div style={{ width: `${percent}%`, height: '100%', backgroundColor: statusColor, borderRadius: '4px', transition: 'width 0.3s ease' }} />
                  </div>
                  <div style={{ display: 'flex', gap: '1rem', marginTop: '0.75rem', fontSize: '0.75rem' }}>
                    <span style={{ color: '#93c5fd' }}>처리: <strong>{progress.processedCount}/{progress.totalRecipients}</strong></span>
                    <span style={{ color: '#6ee7b7' }}>성공: <strong>{progress.deliveredCount}</strong></span>
                    <span style={{ color: '#fca5a5' }}>실패: <strong>{progress.failedCount}</strong></span>
                  </div>
                </div>
              );
            })()}

            {/* 발송 완료 요약 카드 */}
            {completedCampaign && (
              <div style={{ marginTop: '0.5rem', padding: '1.25rem', borderRadius: '12px', backgroundColor: completedCampaign.status === 'COMPLETED' ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)', border: `1px solid ${completedCampaign.status === 'COMPLETED' ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)'}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem', fontWeight: 700, fontSize: '0.95rem', color: completedCampaign.status === 'COMPLETED' ? '#6ee7b7' : '#fca5a5' }}>
                  {completedCampaign.status === 'COMPLETED' ? <CheckCircle size={18} /> : <XCircle size={18} />}
                  캠페인 {completedCampaign.status === 'COMPLETED' ? '발송 완료' : '발송 실패'}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem', marginBottom: '1rem' }}>
                  <div style={{ textAlign: 'center', padding: '0.75rem', borderRadius: '8px', backgroundColor: 'rgba(255,255,255,0.03)' }}>
                    <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-main)' }}>{completedCampaign.totalRecipients}</div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>총 발송</div>
                  </div>
                  <div style={{ textAlign: 'center', padding: '0.75rem', borderRadius: '8px', backgroundColor: 'rgba(16,185,129,0.05)' }}>
                    <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#6ee7b7' }}>{completedCampaign.deliveredCount}</div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>성공</div>
                  </div>
                  <div style={{ textAlign: 'center', padding: '0.75rem', borderRadius: '8px', backgroundColor: 'rgba(239,68,68,0.05)' }}>
                    <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#fca5a5' }}>{completedCampaign.failedCount}</div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>실패</div>
                  </div>
                </div>
                <Link href="/dashboard/history" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 1rem', borderRadius: '8px', backgroundColor: 'rgba(59,130,246,0.1)', color: 'var(--primary)', fontSize: '0.8rem', fontWeight: 600, textDecoration: 'none', border: '1px solid rgba(59,130,246,0.2)' }}>
                  히스토리 보기 &rarr;
                </Link>
              </div>
            )}

            <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.75rem' }}>
              <button className="btn-primary" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', padding: '1.25rem', opacity: (isSending || isOverLimit) ? 0.7 : 1, cursor: (isSending || isOverLimit) ? 'not-allowed' : 'pointer' }} disabled={isSending || isOverLimit} onClick={handleSendClick}>
                {isSending ? (
                  <>
                    <Loader size={18} style={{ animation: 'spin 1s linear infinite' }} />
                    발송 중...
                  </>
                ) : (
                  <>
                    <Send size={18} /> 캠페인 발송
                  </>
                )}
              </button>
              {isSending && (
                <button
                  type="button"
                  onClick={handleCancelCampaign}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
                    padding: '1.25rem 1.5rem', borderRadius: '8px', fontWeight: 600, fontSize: '0.875rem',
                    backgroundColor: 'rgba(239,68,68,0.12)', color: '#fca5a5',
                    border: '1px solid rgba(239,68,68,0.25)', cursor: 'pointer',
                    transition: 'background-color 0.2s',
                  }}
                  onMouseOver={(e) => (e.currentTarget.style.backgroundColor = 'rgba(239,68,68,0.2)')}
                  onMouseOut={(e) => (e.currentTarget.style.backgroundColor = 'rgba(239,68,68,0.12)')}
                >
                  <XIcon size={18} /> 취소
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 발송 확인 모달 */}
      {showConfirmModal && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            backgroundColor: 'rgba(0, 0, 0, 0.6)',
            backdropFilter: 'blur(4px)',
          }}
          onClick={() => setShowConfirmModal(false)}
        >
          <div
            className="glass-card"
            style={{ padding: '2rem', maxWidth: '420px', width: '90%' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.25rem', fontWeight: 700, fontSize: '1.05rem', color: 'var(--text-main)' }}>
              <AlertTriangle size={20} color="#f59e0b" /> 발송 확인
            </div>
            <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', lineHeight: 1.7, marginBottom: '1.5rem' }}>
              <strong style={{ color: 'var(--text-main)' }}>{validRecipients.length}명</strong>에게
              <strong style={{ color: 'var(--primary)' }}> ₩{estimatedTotalCost.toLocaleString('ko-KR')}</strong> 비용으로
              SMS를 발송합니다.
              <div style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                (건당 ₩{costPerMessage.toLocaleString('ko-KR')})
              </div>
              {invalidRecipients.length > 0 && (
                <div style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: '#fca5a5' }}>
                  (유효하지 않은 번호 {invalidRecipients.length}개는 제외됩니다)
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button
                type="button"
                onClick={() => setShowConfirmModal(false)}
                style={{
                  flex: 1, padding: '0.75rem', borderRadius: '8px', fontWeight: 600, fontSize: '0.875rem',
                  backgroundColor: 'rgba(255,255,255,0.05)', color: 'var(--text-secondary)',
                  border: '1px solid var(--border)', cursor: 'pointer',
                }}
              >
                취소
              </button>
              <button
                className="btn-primary"
                type="button"
                onClick={handleSend}
                style={{ flex: 1, padding: '0.75rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', cursor: 'pointer' }}
              >
                <Send size={16} /> 발송하기
              </button>
            </div>
          </div>
        </div>
      )}

      <div style={{ width: '380px', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        {/* 휴대폰 미리보기 */}
        <div style={{ position: 'relative' }}>
          <div style={{ width: '300px', height: '600px', border: '12px solid #1e293b', borderRadius: '40px', margin: '0 auto', backgroundColor: '#000', position: 'relative', overflow: 'hidden' }}>
            <div style={{ height: '60px', backgroundColor: '#1e293b', padding: '25px 1rem 0', textAlign: 'center', borderBottom: '1px solid #334155' }}>
              <div style={{ width: '40px', height: '4px', backgroundColor: '#334155', borderRadius: '2px', margin: '0 auto' }} />
            </div>
            <div style={{ padding: '1.5rem' }}>
              <div style={{ backgroundColor: '#1e293b', padding: '1rem', borderRadius: '12px 12px 12px 2px', fontSize: '0.875rem', color: '#fff', wordBreak: 'break-all', minHeight: '40px' }}>
                {message || '미리보기가 여기에 표시됩니다...'}
              </div>
              {/* 미리보기 글자수 표시 */}
              <div style={{ marginTop: '0.75rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.7rem', color: isOverLimit ? '#ef4444' : '#64748b' }}>
                <span>{smsInfo.encoding}</span>
                <span style={{ fontWeight: 600 }}>
                  {smsInfo.charCount} / {smsInfo.maxChars}자 (남은 글자: {smsInfo.remaining > 0 ? smsInfo.remaining : 0}자)
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* 비용 예상 카드 */}
        <div className="glass-card" style={{ padding: '1.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem', color: 'var(--primary)', fontWeight: 600 }}>
            <Info size={16} /> 비용 예상
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem' }}>
              <span style={{ color: 'var(--text-secondary)' }}>수신자 수</span>
              <span>{validRecipients.length}명</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem' }}>
              <span style={{ color: 'var(--text-secondary)' }}>인코딩</span>
              <span>{smsInfo.encoding} (최대 {smsInfo.maxChars}자)</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem' }}>
              <span style={{ color: 'var(--text-secondary)' }}>건당 비용</span>
              <span>₩{costPerMessage.toLocaleString('ko-KR')}</span>
            </div>
            <div style={{ height: '1px', backgroundColor: 'var(--border)', margin: '0.5rem 0' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '1rem', fontWeight: 700 }}>
              <span style={{ color: 'var(--primary)' }}>예상 총 비용</span>
              <span>₩{estimatedTotalCost.toLocaleString('ko-KR')}</span>
            </div>
          </div>
          <div style={{ marginTop: '1rem', fontSize: '0.75rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            - 영문만: 160자 = 1건 (GSM-7)<br />
            - 한글/이모지 포함: 70자 = 1건 (UCS-2)<br />
            - 글자수 초과 시 발송이 차단됩니다
          </div>
        </div>
      </div>
    </div>
  );
}
