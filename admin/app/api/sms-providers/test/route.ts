import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/admin-session';
import { requirePermission } from '@/lib/rbac';
import { getProviderByName } from '@shared/sms-providers/router';
import type { SmsProviderName } from '@shared/sms-providers/types';
import { handleApiError } from '@shared/api-error';

const VALID_PROVIDER_NAMES: SmsProviderName[] = ['infobip', 'smsto', 'txg'];

// ---------------------------------------------------------------------------
// POST /api/sms-providers/test — 프로바이더 연결 테스트 (잔액 조회)
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    const admin = await requireAuth(request);
    requirePermission(admin, 'setting:read');

    const body = await request.json();
    const { provider: providerName } = body;

    if (!providerName || !VALID_PROVIDER_NAMES.includes(providerName)) {
      return NextResponse.json(
        { error: '유효하지 않은 프로바이더입니다.' },
        { status: 400 },
      );
    }

    const provider = getProviderByName(providerName);

    if (!provider.isConfigured()) {
      return NextResponse.json({
        success: false,
        error: 'API 키가 설정되지 않았습니다.',
      });
    }

    const balance = await provider.getBalance();

    if (!balance) {
      return NextResponse.json({
        success: false,
        error: '연결 실패 — API 응답 없음',
      });
    }

    // 한국향 1세그먼트(UCS-2 70자) 단가 — 잔액 → 건수 환산용
    // TXG: €0.0055/건 (2026-04-24 실측, USD 아님)
    const KOREA_RATE_PER_SEGMENT: Partial<Record<SmsProviderName, number>> = {
      txg: 0.0055,
    };

    const rate = KOREA_RATE_PER_SEGMENT[providerName as SmsProviderName];
    const remainingCount = rate ? Math.floor(balance.balance / rate) : null;

    return NextResponse.json({
      success: true,
      balance: balance.balance,
      currency: balance.currency,
      remainingCount,
    });
  } catch (err) {
    return handleApiError(err, 'sms-providers/test');
  }
}
