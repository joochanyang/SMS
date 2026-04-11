'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

type Props = {
  estimatedCost: number;
  costPerMessage: number;
  messageBody: string;
};

export default function MessageSectionClient({ estimatedCost, costPerMessage, messageBody }: Props) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="glass-card" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div style={{ display: 'flex', gap: '2rem', alignItems: 'center' }}>
        <div>
          <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>예상 비용</span>
          <div style={{ fontSize: '1.25rem', fontWeight: 700, marginTop: '0.25rem' }}>${estimatedCost.toFixed(2)}</div>
        </div>
        <div style={{ width: '1px', height: '40px', backgroundColor: 'var(--border)' }} />
        <div>
          <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>건당 비용</span>
          <div style={{ fontSize: '1.25rem', fontWeight: 700, marginTop: '0.25rem' }}>${costPerMessage.toFixed(4)}</div>
        </div>
        <div style={{ width: '1px', height: '40px', backgroundColor: 'var(--border)' }} />
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>메시지 내용</span>
            <button
              onClick={() => setExpanded(!expanded)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.25rem',
                padding: '0.125rem 0.5rem',
                borderRadius: '0.375rem',
                fontSize: '0.6875rem',
                color: 'var(--text-secondary)',
                backgroundColor: 'rgba(148, 163, 184, 0.1)',
                border: '1px solid var(--border)',
                cursor: 'pointer',
              }}
            >
              {expanded ? '접기' : '전체 보기'}
              {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            </button>
          </div>
          <div style={{
            fontSize: '0.875rem',
            color: 'var(--text-main)',
            marginTop: '0.25rem',
            maxWidth: '500px',
            ...(expanded
              ? { whiteSpace: 'pre-wrap', wordBreak: 'break-word' }
              : { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }),
          }}>
            {messageBody}
          </div>
        </div>
      </div>
    </div>
  );
}
