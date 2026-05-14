import { Trash2 } from 'lucide-react';

export type RecentCampaign = {
  id: string;
  messageBody: string;
  status: string;
  totalRecipients: number;
  createdAt: string;
};

type RecentCampaignsProps = {
  campaigns: RecentCampaign[];
  onLoadMessage: (message: string) => void;
  onDeleteCampaign: (campaignId: string) => void;
};

function getStatusLabel(status: string) {
  if (status === 'COMPLETED') return '전송완료';
  if (status === 'FAILED') return '실패';
  if (status === 'CANCELLED') return '취소';
  if (status === 'SCHEDULED') return '예약됨';
  return '처리중';
}

export default function RecentCampaigns({
  campaigns,
  onLoadMessage,
  onDeleteCampaign,
}: RecentCampaignsProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1rem' }}>
      <h3 style={{ fontSize: '1rem', fontWeight: 700, color: '#111827', margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <span>📩</span> 최근 발송된 메세지 ({campaigns.length}건)
      </h3>

      {campaigns.length === 0 ? (
        <div style={{ padding: '2rem', textAlign: 'center', color: '#6B7280', fontSize: '0.9rem', backgroundColor: '#FFFFFF', borderRadius: '8px', border: '1px solid #E5E7EB' }}>
          발송 내역이 없습니다.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '1rem' }}>
          {campaigns.map((campaign) => (
            <div key={campaign.id} style={{ backgroundColor: '#FFFFFF', borderRadius: '8px', border: '1px solid #E5E7EB', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem', minHeight: '160px', position: 'relative' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <button
                  onClick={() => onLoadMessage(campaign.messageBody)}
                  style={{ color: '#4F46E5', fontWeight: 600, fontSize: '0.85rem', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.25rem', padding: 0 }}
                >
                  ⊕ 불러오기
                </button>
                <span style={{ fontSize: '0.75rem', color: '#9CA3AF' }}>{new Date(campaign.createdAt).toLocaleString('ko-KR')}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.75rem', color: '#6B7280' }}>상태: {getStatusLabel(campaign.status)} | {campaign.totalRecipients}건</span>
                <button
                  onClick={() => onDeleteCampaign(campaign.id)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF', padding: '2px', display: 'flex', alignItems: 'center' }}
                  title="삭제"
                >
                  <Trash2 size={14} />
                </button>
              </div>
              <div style={{ fontSize: '0.85rem', color: '#374151', lineHeight: 1.5, whiteSpace: 'pre-line', overflow: 'hidden', flex: 1 }}>
                {campaign.messageBody}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
