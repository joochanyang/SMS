'use client';

import { CreditCard, Plus, Minus, Edit3 } from 'lucide-react';
import { formatCountWithKrw } from '@/lib/credit-units';

interface Props {
  credits: number;
  costPerMessage: number;
  canAdjustCredits: boolean;
  canEditCost: boolean;
  onTopUp: () => void;
  onDeduct: () => void;
  onEditCost: () => void;
}

export default function AdminUserBillingCard({
  credits,
  costPerMessage,
  canAdjustCredits,
  canEditCost,
  onTopUp,
  onDeduct,
  onEditCost,
}: Props) {
  return (
    <div className="card" style={{ marginBottom: '16px' }}>
      <div className="card-header">
        <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
          <CreditCard size={18} /> 빌링 / 잔액
        </h3>
      </div>
      <div className="card-body">
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
            gap: '14px',
            marginBottom: '14px',
          }}
        >
          <div>
            <span className="label">남은 건수</span>
            <p style={{ fontWeight: 700, fontSize: '20px' }}>
              {formatCountWithKrw(credits, costPerMessage)}
            </p>
          </div>
          <div>
            <span className="label">건당 단가</span>
            <p style={{ fontWeight: 700, fontSize: '20px', color: 'var(--status-info)' }}>
              {'₩'}
              {Number(costPerMessage).toLocaleString('ko-KR')}
              {canEditCost && (
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={onEditCost}
                  style={{ marginLeft: '6px' }}
                  aria-label="단가 수정"
                >
                  <Edit3 size={12} />
                </button>
              )}
            </p>
          </div>
        </div>

        {canAdjustCredits && (
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="btn btn-primary btn-sm" onClick={onTopUp}>
              <Plus size={14} /> 건수 지급
            </button>
            <button className="btn btn-outline-danger btn-sm" onClick={onDeduct}>
              <Minus size={14} /> 건수 차감
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
