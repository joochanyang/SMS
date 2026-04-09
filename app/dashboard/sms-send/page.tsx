'use client';

import React, { useMemo, useState } from 'react';
import Papa from 'papaparse';
import { Send, Upload, Info, Smartphone, Users } from 'lucide-react';

const COST_PER_MESSAGE_USD = 0.05;
const DEFAULT_BATCH_SIZE = 200;

type MessageType = 'TRANSACTIONAL' | 'AD';

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
  const [messageType, setMessageType] = useState<MessageType>('TRANSACTIONAL');
  const [message, setMessage] = useState('');
  const [recipients, setRecipients] = useState('');
  const [campaignName, setCampaignName] = useState('');
  const [csvFilename, setCsvFilename] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [progress, setProgress] = useState<CampaignProgress | null>(null);

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

  const estimatedTotalCost = parsedRecipients.length * COST_PER_MESSAGE_USD;

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
        setStatusMessage(`CSV 파싱 완료: ${values.length}개 원본 항목을 불러왔습니다.`);
      },
      error: () => setStatusError('CSV 파싱에 실패했습니다. 파일 형식을 확인하세요.'),
    });
  };

  const processCampaignLoop = async (campaignId: string) => {
    for (let i = 0; i < 1000; i++) {
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

  const handleSend = async () => {
    setStatusMessage(null);
    setStatusError(null);
    setProgress(null);

    if (!message.trim()) {
      setStatusError('메시지 내용을 입력하세요.');
      return;
    }
    if (parsedRecipients.length === 0) {
      setStatusError('최소 1개 이상의 수신 번호를 입력하세요.');
      return;
    }

    try {
      setIsSending(true);
      const createRes = await fetch('/api/sms/campaign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: campaignName || undefined,
          messageType,
          recipients: parsedRecipients,
          message,
        }),
      });
      const createData = await createRes.json();
      if (!createRes.ok) {
        setStatusError(createData.error || '캠페인 생성에 실패했습니다.');
        return;
      }

      const campaignId = createData.campaignId as string;
      setStatusMessage(`캠페인 생성 완료. 자동 배치 발송을 시작합니다. (ID: ${campaignId})`);
      const finalCampaign = await processCampaignLoop(campaignId);

      setStatusMessage(
        `캠페인 처리 완료: 상태=${finalCampaign.status}, 처리=${finalCampaign.processedCount}/${finalCampaign.totalRecipients}, 실패=${finalCampaign.failedCount}`
      );
      if (finalCampaign.failedCount > 0) {
        setStatusError('일부 건은 실패/재시도 초과되었습니다. 히스토리에서 상세 상태를 확인하세요.');
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
              Single Dispatch
            </button>
            <button onClick={() => setActiveTab('bulk')} style={{ padding: '0.5rem 1rem', color: activeTab === 'bulk' ? 'var(--primary)' : 'var(--text-secondary)', fontWeight: 600, borderBottom: activeTab === 'bulk' ? '2px solid var(--primary)' : 'none' }}>
              Bulk Marketing (CSV)
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <label style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>Campaign Name (optional)</label>
                <input value={campaignName} onChange={(e) => setCampaignName(e.target.value)} placeholder="예: 4월 한국 캠페인" style={{ width: '100%', backgroundColor: 'rgba(2, 6, 23, 0.5)', border: '1px solid var(--border)', borderRadius: '8px', padding: '0.75rem 1rem', color: 'var(--text-main)', outline: 'none' }} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <label style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>Message Type</label>
                <select value={messageType} onChange={(e) => setMessageType(e.target.value as MessageType)} style={{ width: '100%', backgroundColor: 'rgba(2, 6, 23, 0.5)', border: '1px solid var(--border)', borderRadius: '8px', padding: '0.75rem 1rem', color: 'var(--text-main)', outline: 'none' }}>
                  <option value="TRANSACTIONAL">TRANSACTIONAL (일반/알림)</option>
                  <option value="AD">AD (광고성)</option>
                </select>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                {activeTab === 'single' ? <Smartphone size={16} /> : <Users size={16} />}
                {activeTab === 'single' ? 'Recipient Numbers' : 'CSV Campaign Data'}
              </label>

              {activeTab === 'single' ? (
                <textarea placeholder="Enter numbers (e.g., 01012345678), separated by comma or new line" value={recipients} onChange={(e) => setRecipients(e.target.value)} style={{ width: '100%', minHeight: '120px', backgroundColor: 'rgba(2, 6, 23, 0.5)', border: '1px solid var(--border)', borderRadius: '8px', padding: '1rem', color: 'var(--text-main)', outline: 'none', resize: 'vertical' }} />
              ) : (
                <label style={{ border: '2px dashed var(--border)', borderRadius: '12px', padding: '2rem', textAlign: 'center', backgroundColor: 'rgba(2, 6, 23, 0.3)', cursor: 'pointer', display: 'block' }}>
                  <input type="file" accept=".csv,text/csv" style={{ display: 'none' }} onChange={(e) => { const file = e.target.files?.[0]; if (file) parseCsvFile(file); }} />
                  <Upload size={32} color="var(--primary)" style={{ marginBottom: '1rem' }} />
                  <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>CSV 파일 선택</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{csvFilename ? `선택됨: ${csvFilename}` : '전화번호 컬럼이 있는 CSV 업로드'}</div>
                </label>
              )}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>Message Content</label>
                <span style={{ fontSize: '0.75rem', color: message.length > 90 ? '#f59e0b' : 'var(--primary)' }}>
                  {message.length} / {message.length > 90 ? '2000 (LMS)' : '90 (SMS)'} bytes
                </span>
              </div>
              <textarea placeholder="Type your message here..." value={message} onChange={(e) => setMessage(e.target.value)} style={{ width: '100%', minHeight: '180px', backgroundColor: 'rgba(2, 6, 23, 0.5)', border: '1px solid var(--border)', borderRadius: '8px', padding: '1rem', color: 'var(--text-main)', outline: 'none', resize: 'vertical' }} />
            </div>

            {statusError && <div style={{ marginTop: '0.5rem', padding: '0.75rem 1rem', borderRadius: '8px', backgroundColor: 'rgba(239,68,68,0.08)', color: '#fca5a5', fontSize: '0.8rem' }}>{statusError}</div>}
            {statusMessage && <div style={{ marginTop: '0.5rem', padding: '0.75rem 1rem', borderRadius: '8px', backgroundColor: 'rgba(16,185,129,0.08)', color: '#6ee7b7', fontSize: '0.8rem' }}>{statusMessage}</div>}
            {progress && (
              <div style={{ marginTop: '0.5rem', padding: '0.75rem 1rem', borderRadius: '8px', backgroundColor: 'rgba(59,130,246,0.08)', color: '#93c5fd', fontSize: '0.8rem' }}>
                진행 상태: {progress.status} / {progress.processedCount} / {progress.totalRecipients} · 실패 {progress.failedCount} · 전달완료 {progress.deliveredCount}
              </div>
            )}

            <button className="btn-primary" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', padding: '1.25rem', marginTop: '0.75rem', opacity: isSending ? 0.7 : 1 }} disabled={isSending} onClick={handleSend}>
              <Send size={18} /> {isSending ? 'Dispatching...' : 'Dispatch Campaign'}
            </button>
          </div>
        </div>
      </div>

      <div style={{ width: '380px', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        <div style={{ position: 'relative' }}>
          <div style={{ width: '300px', height: '600px', border: '12px solid #1e293b', borderRadius: '40px', margin: '0 auto', backgroundColor: '#000', position: 'relative', overflow: 'hidden' }}>
            <div style={{ height: '60px', backgroundColor: '#1e293b', padding: '25px 1rem 0', textAlign: 'center', borderBottom: '1px solid #334155' }}>
              <div style={{ width: '40px', height: '4px', backgroundColor: '#334155', borderRadius: '2px', margin: '0 auto' }} />
            </div>
            <div style={{ padding: '1.5rem' }}>
              <div style={{ backgroundColor: '#1e293b', padding: '1rem', borderRadius: '12px 12px 12px 2px', fontSize: '0.875rem', color: '#fff', wordBreak: 'break-all', minHeight: '40px' }}>
                {message || 'Preview will appear here...'}
              </div>
            </div>
          </div>
        </div>

        <div className="glass-card" style={{ padding: '1.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem', color: 'var(--primary)', fontWeight: 600 }}>
            <Info size={16} /> Cost Estimation
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Estimated Recipients</span>
              <span>{parsedRecipients.length}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Cost per Message</span>
              <span>${COST_PER_MESSAGE_USD.toFixed(2)}</span>
            </div>
            <div style={{ height: '1px', backgroundColor: 'var(--border)', margin: '0.5rem 0' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '1rem', fontWeight: 700 }}>
              <span style={{ color: 'var(--primary)' }}>Total Estimated</span>
              <span>${estimatedTotalCost.toFixed(2)}</span>
            </div>
          </div>
          <div style={{ marginTop: '1rem', fontSize: '0.75rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            - 한국 번호는 자동으로 +82 형식으로 정규화됩니다.<br />
            - 광고성(AD) 선택 시 메시지에 `(광고)`와 `무료 수신거부` 문구가 필요합니다.
          </div>
        </div>
      </div>
    </div>
  );
}
