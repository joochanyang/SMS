import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/admin-session';
import { requirePermission } from '@/lib/rbac';
import { getProviderByName } from '@shared/sms-providers/router';
import type { SmsProviderName } from '@shared/sms-providers/types';

// ---------------------------------------------------------------------------
// POST /api/sms-providers/test — 프로바이더 연결 테스트 (잔액 조회)
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    const admin = await requireAuth(request);
    requirePermission(admin, 'setting:read');

    const body = await request.json();
    const { provider: providerName } = body;

    const validNames: SmsProviderName[] = ['infobip', 'smsto'];
    if (!providerName || !validNames.includes(providerName)) {
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

    return NextResponse.json({
      success: true,
      balance: balance.balance,
      currency: balance.currency,
    });
  } catch (err) {
    if (err instanceof Error) {
      const status = (err as any).status;
      if (status === 401 || status === 403) {
        return NextResponse.json({ error: err.message }, { status });
      }
    }
    console.error('[API] sms-providers/test:', err);
    return NextResponse.json({ error: '연결 테스트 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
