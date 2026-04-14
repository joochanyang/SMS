'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Papa from 'papaparse';
import { RefreshCw, Bookmark, Type, RotateCcw, AlertTriangle, Loader2, CheckCircle2, XCircle, Trash2, Shuffle } from 'lucide-react';

const DEFAULT_BATCH_SIZE = 200;

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

function cleanPhoneInput(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('+')) {
    return '+' + trimmed.slice(1).replace(/[^0-9]/g, '');
  }
  return trimmed.replace(/[^0-9]/g, '');
}

function isValidPhone(raw: string): boolean {
  const cleaned = cleanPhoneInput(raw);
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
  // Logic states
  const [message, setMessage] = useState('');
  const [recipients, setRecipients] = useState('');
  const [activeTab, setActiveTab] = useState<'manual' | 'csv' | 'hidden'>('hidden');
  const [, setCsvFilename] = useState<string | null>(null);
  
  const [creditBalance, setCreditBalance] = useState<number>(0);
  const [costPerMessage, setCostPerMessage] = useState<number>(14);
  
  const [senderId, setSenderId] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [showDuplicateModal, setShowDuplicateModal] = useState(false);
  const [showInsufficientModal, setShowInsufficientModal] = useState(false);
  const [duplicateCount, setDuplicateCount] = useState(0);

  const [progress, setProgress] = useState<CampaignProgress | null>(null);
  const [completedCampaign, setCompletedCampaign] = useState<CampaignProgress | null>(null);

  const activeCampaignIdRef = useRef<string | null>(null);
  const cancelledRef = useRef(false);

  // 최근 발송 캠페인 목록 (최대 20개)
  type RecentCampaign = { id: string; messageBody: string; status: string; totalRecipients: number; createdAt: string };
  const [recentCampaigns, setRecentCampaigns] = useState<RecentCampaign[]>([]);

  const fetchRecentCampaigns = () => {
    fetch('/api/sms/campaign')
      .then((res) => res.ok ? res.json() : null)
      .then((data) => { if (data?.campaigns) setRecentCampaigns(data.campaigns); })
      .catch(() => {});
  };

  const handleDeleteCampaign = async (campaignId: string) => {
    const res = await fetch(`/api/sms/campaign/${campaignId}`, { method: 'DELETE' });
    if (res.ok) setRecentCampaigns((prev) => prev.filter((c) => c.id !== campaignId));
  };

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
    fetchRecentCampaigns();
  }, []);

  const smsInfo = useMemo(() => getSmsInfo(message), [message]);

  const parsedRecipients = useMemo(() => {
    if (!recipients.trim()) return [];
    return recipients.split(/[\n,]/).map((r) => cleanPhoneInput(r)).filter(Boolean);
  }, [recipients]);

  const { validRecipients, rawDuplicateCount } = useMemo(() => {
    const valid: string[] = [];
    const invalid: string[] = [];
    const seen = new Set<string>();
    let dupes = 0;
    for (const r of parsedRecipients) {
      if (!isValidPhone(r)) {
        invalid.push(r);
        continue;
      }
      if (seen.has(r)) {
        dupes++;
        continue;
      }
      seen.add(r);
      valid.push(r);
    }
    return { validRecipients: valid, rawDuplicateCount: dupes };
  }, [parsedRecipients]);

  const estimatedTotalCost = validRecipients.length * costPerMessage;
  const availableSendCount = costPerMessage > 0 ? Math.floor(creditBalance / costPerMessage) : 0;
  const isOverBalance = validRecipients.length > availableSendCount && validRecipients.length > 0;
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
    if (isOverBalance) {
      setShowInsufficientModal(true);
      return;
    }
    if (rawDuplicateCount > 0) {
      setDuplicateCount(rawDuplicateCount);
      setShowDuplicateModal(true);
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
          ...(senderId.trim() && { senderId: senderId.trim() }),
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

      setCompletedCampaign({
        id: finalCampaign.id,
        status: finalCampaign.status,
        processedCount: finalCampaign.processedCount,
        totalRecipients: finalCampaign.totalRecipients,
        failedCount: finalCampaign.failedCount,
        deliveredCount: finalCampaign.deliveredCount,
      });
      setProgress(null);
      setStatusMessage(null);

      // 발송 후 최근 캠페인 목록 갱신
      fetchRecentCampaigns();

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
    <div style={{ padding: '2rem', maxWidth: '1440px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '3rem' }}>
      
      {/* Modals and Error Overlays */}
      {showConfirmModal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0, 0, 0, 0.4)', backdropFilter: 'blur(4px)' }}>
          <div style={{ backgroundColor: '#FFFFFF', padding: '2rem', borderRadius: '12px', maxWidth: '420px', width: '90%', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)' }}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 800, color: '#111827', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}><AlertTriangle color="#F59E0B" /> 발송 확인</h3>
            <p style={{ color: '#4B5563', lineHeight: 1.5, marginBottom: '1.5rem' }}>
              <strong style={{ color: '#4F46E5' }}>{validRecipients.length}건</strong>을 발송합니다. (잔여: <strong style={{ color: '#111827' }}>{(availableSendCount - validRecipients.length).toLocaleString()}건</strong>)
            </p>
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button onClick={() => setShowConfirmModal(false)} style={{ flex: 1, padding: '0.75rem', borderRadius: '6px', border: '1px solid #D1D5DB', background: '#FFFFFF', color: '#4B5563', fontWeight: 600, cursor: 'pointer' }}>취소</button>
              <button onClick={handleSend} style={{ flex: 1, padding: '0.75rem', borderRadius: '6px', border: 'none', background: '#4F46E5', color: '#FFFFFF', fontWeight: 600, cursor: 'pointer' }}>발송하기</button>
            </div>
          </div>
        </div>
      )}

      {showDuplicateModal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0, 0, 0, 0.4)', backdropFilter: 'blur(4px)' }}>
          <div style={{ backgroundColor: '#FFFFFF', padding: '2rem', borderRadius: '12px', maxWidth: '420px', width: '90%', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)' }}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 800, color: '#F59E0B', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}><AlertTriangle color="#F59E0B" /> 중복 번호 발견</h3>
            <p style={{ color: '#4B5563', lineHeight: 1.5, marginBottom: '1.5rem' }}>
              중복 번호 <strong>{duplicateCount}건</strong>을 제외하고 발송하시겠습니까? (최종 발송: {validRecipients.length}건)
            </p>
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button onClick={() => setShowDuplicateModal(false)} style={{ flex: 1, padding: '0.75rem', borderRadius: '6px', border: '1px solid #D1D5DB', background: '#FFFFFF', color: '#4B5563', fontWeight: 600, cursor: 'pointer' }}>취소</button>
              <button onClick={() => { setShowDuplicateModal(false); setShowConfirmModal(true); }} style={{ flex: 1, padding: '0.75rem', borderRadius: '6px', border: 'none', background: '#4F46E5', color: '#FFFFFF', fontWeight: 600, cursor: 'pointer' }}>제외하고 발송</button>
            </div>
          </div>
        </div>
      )}

      {showInsufficientModal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0, 0, 0, 0.4)', backdropFilter: 'blur(4px)' }}>
          <div style={{ backgroundColor: '#FFFFFF', padding: '2rem', borderRadius: '12px', maxWidth: '420px', width: '90%', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)' }}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 800, color: '#EF4444', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}><XCircle color="#EF4444" /> 발송 건수 부족</h3>
            <p style={{ color: '#4B5563', lineHeight: 1.5, marginBottom: '1.5rem' }}>
              요청 건수: {validRecipients.length.toLocaleString()}건<br/>
              잔여 건수: <strong>{availableSendCount.toLocaleString()}건</strong><br/><br/>
              발송 전 건수를 충전하시기 바랍니다.
            </p>
            <button onClick={() => setShowInsufficientModal(false)} style={{ width: '100%', padding: '0.75rem', borderRadius: '6px', border: 'none', background: '#EF4444', color: '#FFFFFF', fontWeight: 600, cursor: 'pointer' }}>확인</button>
          </div>
        </div>
      )}

      {/* Top Layout: Left (Editor) + Right (Recipients) */}
      <div style={{ display: 'flex', gap: '2rem', alignItems: 'flex-start' }}>
        
        {/* Left Column: Phone/Editor View */}
        <div style={{ width: '340px', flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
          
          <div style={{ 
            backgroundColor: '#FFFFFF', 
            border: `1px solid ${isOverLimit ? '#EF4444' : '#E5E7EB'}`,
            borderRadius: '8px', 
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)'
          }}>
            {/* 발신번호 */}
            <div style={{
              display: 'flex', alignItems: 'center', padding: '0.75rem 1rem',
              borderBottom: '1px solid #F3F4F6', gap: '0.5rem'
            }}>
              <label style={{ fontSize: '0.8rem', fontWeight: 700, color: '#374151', whiteSpace: 'nowrap' }}>발신번호</label>
              <input
                type="text"
                maxLength={11}
                placeholder="자동 생성 (매 발송마다 변경)"
                value={senderId}
                onChange={(e) => setSenderId(e.target.value.replace(/[^a-zA-Z0-9 ]/g, '').slice(0, 11))}
                disabled={isSending}
                style={{
                  flex: 1, padding: '0.4rem 0.6rem', border: '1px solid #E5E7EB', borderRadius: '6px',
                  fontSize: '0.85rem', color: '#111827', outline: 'none',
                }}
              />
              <button
                onClick={() => {
                  const alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
                  const alphanum = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
                  let id = alpha[Math.floor(Math.random() * 26)];
                  for (let i = 1; i < 8; i++) id += alphanum[Math.floor(Math.random() * 36)];
                  setSenderId(id);
                }}
                title="랜덤 생성"
                style={{
                  padding: '0.4rem', borderRadius: '6px', border: '1px solid #E5E7EB',
                  background: '#FFFFFF', cursor: 'pointer', display: 'flex', alignItems: 'center',
                }}
              >
                <Shuffle size={16} color="#4F46E5" />
              </button>
            </div>

            {/* Header info */}
            <div style={{
              display: 'flex', justifyContent: 'space-between', padding: '1rem',
              fontSize: '0.85rem', fontWeight: 600, color: isOverLimit ? '#EF4444' : '#374151',
              borderBottom: '1px solid #F3F4F6'
            }}>
              <span>{smsInfo.charCount} / {smsInfo.maxChars} ({smsInfo.encoding})</span>
              <span style={{ color: '#6B7280' }}>
                {new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute:'2-digit' })}
              </span>
            </div>

            {/* Main Text Area */}
            <div style={{ position: 'relative', height: '280px' }}>
              <textarea
                placeholder="문자 메시지 - SMS"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                disabled={isSending}
                style={{ 
                  width: '100%', height: '100%', border: 'none', resize: 'none', 
                  padding: '1rem', fontSize: '1rem', color: '#111827', outline: 'none'
                }}
              />
              <button 
                onClick={() => setMessage('')}
                style={{
                  position: 'absolute', bottom: '1rem', right: '1rem',
                  width: '32px', height: '32px', borderRadius: '50%',
                  backgroundColor: 'rgba(79, 70, 229, 0.1)', color: '#4F46E5',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  border: 'none', cursor: 'pointer'
                }}
              >
                <RotateCcw size={16} />
              </button>
            </div>

            {/* Tool buttons */}
            <div style={{ 
              display: 'flex', borderTop: '1px solid #F3F4F6', borderBottom: '1px solid #F3F4F6',
              padding: '0.5rem'
            }}>
              <button style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.35rem', padding: '0.5rem', border: 'none', background: 'none', cursor: 'pointer', fontSize: '0.8rem', color: '#4B5563', fontWeight: 500 }}>
                <RefreshCw size={14} /> 변수
              </button>
              <button style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.35rem', padding: '0.5rem', border: 'none', background: 'none', cursor: 'pointer', fontSize: '0.8rem', color: '#4B5563', fontWeight: 500 }}>
                <Bookmark size={14} /> 문구
              </button>
              <button style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.35rem', padding: '0.5rem', border: 'none', background: 'none', cursor: 'pointer', fontSize: '0.8rem', color: '#4B5563', fontWeight: 500 }}>
                <Type size={14} /> 특수
              </button>
            </div>

            {/* Schedule Toggle */}
            <div style={{ display: 'flex', padding: '0.75rem', gap: '0.5rem' }}>
              <button style={{ flex: 1, padding: '0.65rem', borderRadius: '6px', border: '1px solid #4F46E5', backgroundColor: '#FFFFFF', color: '#4F46E5', fontSize: '0.85rem', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.3rem', cursor: 'pointer' }}>
                <span style={{ color: '#4F46E5' }}>✓</span> 즉시
              </button>
              <button style={{ flex: 1, padding: '0.65rem', borderRadius: '6px', border: '1px solid #E5E7EB', backgroundColor: '#FFFFFF', color: '#374151', fontSize: '0.85rem', fontWeight: 500, cursor: 'pointer' }}>
                예약
              </button>
            </div>

            {/* Send Button */}
            <button 
              disabled={isSending || isOverLimit || isOverBalance}
              onClick={handleSendClick}
              style={{ 
                width: '100%', padding: '1.25rem', border: 'none', 
                backgroundColor: (isSending || isOverLimit || isOverBalance) ? '#9CA3AF' : '#4F46E5', 
                color: '#FFFFFF', fontSize: '1rem', fontWeight: 700, cursor: (isSending || isOverLimit) ? 'not-allowed' : 'pointer', transition: 'background-color 0.2s',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem'
              }}
            >
              {isSending ? <><Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} /> 처리 중...</> : '전송하기'}
            </button>
          </div>

          {/* Alert Messages underneath Phone */}
          {statusError && (
             <div style={{ marginTop: '1rem', padding: '0.75rem', borderRadius: '8px', backgroundColor: '#FEF2F2', border: '1px solid #FCA5A5', color: '#EF4444', fontSize: '0.8rem', fontWeight: 600 }}>
               {statusError}
             </div>
          )}
          {statusMessage && (
             <div style={{ marginTop: '1rem', padding: '0.75rem', borderRadius: '8px', backgroundColor: '#F0FDF4', border: '1px solid #86EFAC', color: '#10B981', fontSize: '0.8rem', fontWeight: 600 }}>
               {statusMessage}
             </div>
          )}
        </div>

        {/* Right Column: Recipients Table */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          
          {/* Table Header Controls */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <h2 style={{ fontSize: '1.2rem', fontWeight: 800, color: '#111827', margin: 0 }}>발송대상</h2>
              <span style={{ fontSize: '0.85rem', color: '#6B7280', fontWeight: 600 }}>{validRecipients.length} 유효 발송대상</span>
            </div>
            
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button onClick={() => setActiveTab('hidden')} style={{ padding: '0.5rem 1rem', borderRadius: '6px', border: '1px solid #E5E7EB', backgroundColor: '#FFFFFF', color: '#4B5563', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer' }}>
                주소록
              </button>
              <button 
                onClick={() => setActiveTab(activeTab === 'manual' ? 'hidden' : 'manual')} 
                style={{ padding: '0.5rem 1rem', borderRadius: '6px', border: activeTab === 'manual' ? '1px solid #4F46E5' : '1px solid #E5E7EB', backgroundColor: activeTab === 'manual' ? 'rgba(79,70,229,0.05)' : '#FFFFFF', color: activeTab === 'manual' ? '#4F46E5' : '#4B5563', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer' }}
              >
                직접 입력
              </button>
              <label 
                style={{ padding: '0.5rem 1rem', borderRadius: '6px', border: '1px solid #E5E7EB', backgroundColor: '#FFFFFF', color: '#4B5563', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center' }}
              >
                <input type="file" accept=".csv,text/csv" style={{ display: 'none' }} disabled={isSending} onChange={(e) => { const file = e.target.files?.[0]; if (file) parseCsvFile(file); }} />
                파일 업로드
              </label>
              <button onClick={() => {}} style={{ padding: '0.5rem 1rem', borderRadius: '6px', border: '1px solid #E5E7EB', backgroundColor: '#FFFFFF', color: '#4B5563', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer' }}>
                양식 다운
              </button>
              <button 
                onClick={() => { setRecipients(''); setMessage(''); setActiveTab('hidden'); }}
                style={{ padding: '0.5rem 1rem', borderRadius: '6px', border: 'none', backgroundColor: '#EF4444', color: '#FFFFFF', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer' }}
              >
                비우기
              </button>
            </div>
          </div>

          {/* Active Input Mode area */}
          {activeTab === 'manual' && (
            <textarea
              placeholder="번호를 한 줄에 하나씩 또는 쉼표로 구분하여 입력하세요..."
              value={recipients}
              onChange={(e) => setRecipients(e.target.value)}
              style={{ width: '100%', height: '150px', padding: '1rem', border: '1px solid #4F46E5', borderRadius: '8px', marginBottom: '1rem', outline: 'none', fontSize: '0.9rem', resize: 'vertical' }}
            />
          )}

          {/* Table Container */}
          <div style={{ 
            backgroundColor: '#FFFFFF', borderRadius: '8px', border: '1px solid #E5E7EB',
            overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: '400px'
          }}>
            {/* Table Header */}
            <div style={{ 
              display: 'grid', gridTemplateColumns: '50px 200px 150px 1fr 1fr 1fr', 
              padding: '1rem', borderBottom: '1px solid #E5E7EB', backgroundColor: '#FAFAFA',
              fontSize: '0.85rem', fontWeight: 700, color: '#374151'
            }}>
              <div>No</div>
              <div>연락처</div>
              <div>변수1</div>
              <div>변수2</div>
              <div>변수3</div>
              <div>비고</div>
            </div>

            {/* Empty State or Rows */}
            {validRecipients.length === 0 ? (
               <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6B7280', fontSize: '0.9rem', fontWeight: 600 }}>
                 발송대상을 추가 해 주세요. (직접 입력 또는 파일 업로드)
               </div>
            ) : (
               <div style={{ flex: 1, overflowY: 'auto', maxHeight: '500px' }}>
                 {validRecipients.slice(0, 50).map((num, i) => (
                   <div key={i} style={{ 
                     display: 'grid', gridTemplateColumns: '50px 200px 150px 1fr 1fr 1fr', 
                     padding: '0.75rem 1rem', borderBottom: '1px solid #F3F4F6',
                     fontSize: '0.85rem', color: '#111827'
                   }}>
                     <div style={{ color: '#6B7280' }}>{i + 1}</div>
                     <div style={{ fontWeight: 600 }}>{num}</div>
                     <div>-</div>
                     <div>-</div>
                     <div>-</div>
                     <div></div>
                   </div>
                 ))}
                 {validRecipients.length > 50 && (
                   <div style={{ padding: '1rem', textAlign: 'center', color: '#6B7280', fontSize: '0.85rem' }}>
                     ... 그 외 {validRecipients.length - 50}개 대기 중
                   </div>
                 )}
               </div>
            )}
          </div>

          {/* Credit Costs quick look under table */}
          {validRecipients.length > 0 && (
            <div style={{ display: 'flex', gap: '2rem', justifyContent: 'flex-end', marginTop: '1rem', padding: '1rem', backgroundColor: '#FFFFFF', borderRadius: '8px', border: '1px solid #E5E7EB' }}>
               <div style={{ fontSize: '0.85rem' }}>
                 <span style={{ color: '#6B7280' }}>잔여 건수: </span>
                 <strong style={{ color: '#111827' }}>{availableSendCount.toLocaleString()}건</strong>
               </div>
               <div style={{ fontSize: '0.85rem' }}>
                 <span style={{ color: '#6B7280' }}>발송 건수: </span>
                 <strong style={{ color: '#4F46E5', fontSize: '1rem' }}>{validRecipients.length}건</strong>
               </div>
            </div>
          )}
          
        </div>
      </div>

      {/* Progress Cards etc */}
      {(progress || completedCampaign) && (
         <div style={{ padding: '1.5rem', backgroundColor: '#FFFFFF', borderRadius: '8px', border: '1px solid #E5E7EB' }}>
           <h3 style={{ fontSize: '1.1rem', fontWeight: 800, marginBottom: '1rem' }}>발송 진행 상태</h3>
           {progress && (
             <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
               <div style={{ width: '100%', height: '8px', backgroundColor: '#E5E7EB', borderRadius: '4px', overflow: 'hidden' }}>
                 <div style={{ width: `${Math.round((progress.processedCount / progress.totalRecipients) * 100)}%`, height: '100%', backgroundColor: '#4F46E5', transition: 'width 0.3s' }} />
               </div>
               <div style={{ display: 'flex', gap: '1rem', fontSize: '0.85rem', fontWeight: 600 }}>
                 <span style={{ color: '#4F46E5' }}>진행률: {Math.round((progress.processedCount / progress.totalRecipients) * 100)}%</span>
                 <span>처리: {progress.processedCount}/{progress.totalRecipients}</span>
                 <span style={{ color: '#10B981' }}>성공: {progress.deliveredCount}</span>
                 <span style={{ color: '#EF4444' }}>실패: {progress.failedCount}</span>
               </div>
             </div>
           )}
           {completedCampaign && (
             <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', fontSize: '0.9rem', fontWeight: 600 }}>
               {completedCampaign.status === 'COMPLETED' ? <CheckCircle2 color="#10B981" /> : <XCircle color="#EF4444" />}
               <span>최근 캠페인이 종료되었습니다. 성공: {completedCampaign.deliveredCount}건 / 실패: {completedCampaign.failedCount}건</span>
             </div>
           )}
         </div>
      )}

      {/* Bottom Area: Recent Messages */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1rem' }}>
        <h3 style={{ fontSize: '1rem', fontWeight: 700, color: '#111827', margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span>📩</span> 최근 발송된 메세지 ({recentCampaigns.length}건)
        </h3>

        {recentCampaigns.length === 0 ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: '#6B7280', fontSize: '0.9rem', backgroundColor: '#FFFFFF', borderRadius: '8px', border: '1px solid #E5E7EB' }}>
            발송 내역이 없습니다.
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem' }}>
            {recentCampaigns.map((c) => {
              const statusLabel = c.status === 'COMPLETED' ? '전송완료' : c.status === 'FAILED' ? '실패' : c.status === 'CANCELLED' ? '취소' : c.status === 'SCHEDULED' ? '예약됨' : '처리중';
              return (
                <div key={c.id} style={{ backgroundColor: '#FFFFFF', borderRadius: '8px', border: '1px solid #E5E7EB', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem', minHeight: '160px', position: 'relative' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <button
                      onClick={() => setMessage(c.messageBody)}
                      style={{ color: '#4F46E5', fontWeight: 600, fontSize: '0.85rem', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.25rem', padding: 0 }}
                    >
                      ⊕ 불러오기
                    </button>
                    <span style={{ fontSize: '0.75rem', color: '#9CA3AF' }}>{new Date(c.createdAt).toLocaleString('ko-KR')}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.75rem', color: '#6B7280' }}>상태: {statusLabel} | {c.totalRecipients}건</span>
                    <button
                      onClick={() => handleDeleteCampaign(c.id)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF', padding: '2px', display: 'flex', alignItems: 'center' }}
                      title="삭제"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                  <div style={{ fontSize: '0.85rem', color: '#374151', lineHeight: 1.5, whiteSpace: 'pre-line', overflow: 'hidden', flex: 1 }}>
                    {c.messageBody}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

    </div>
  );
}
