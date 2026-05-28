import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@shared/prisma';
import { requireAuth } from '@/lib/admin-session';
import { requirePermission } from '@/lib/rbac';
import { getAllProviders } from '@shared/sms-providers/router';
import { handleApiError } from '@shared/api-error';
import { mapProviderToBalanceRow, type ProviderName, type BalanceRow } from './mapper';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// GET /api/sms-providers/balances — 활성 라인 + 각 프로바이더 잔액 조회
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  try {
    const admin = await requireAuth(request);
    requirePermission(admin, 'setting:read');

    const activeSetting = await prisma.systemSetting.findUnique({
      where: { key: 'active_sms_provider' },
    });
    const activeValue = activeSetting?.value;
    const activeProvider: string =
      isRecord(activeValue) && typeof activeValue.provider === 'string'
        ? activeValue.provider
        : 'infobip';

    const entries = getAllProviders();
    const now = new Date();
    // 미설정 프로바이더는 외부 HTTP 호출 자체를 건너뛴다 (mapper 의 '미설정' 분기로 처리).
    const results = await Promise.allSettled(
      entries.map((e) => (e.provider.isConfigured() ? e.provider.getBalance() : Promise.resolve(null))),
    );

    const balances: BalanceRow[] = entries.map((entry, idx) => {
      const r = results[idx];
      return mapProviderToBalanceRow({
        name: entry.name as ProviderName,
        isConfigured: entry.provider.isConfigured(),
        isActive: entry.name === activeProvider,
        result:
          r.status === 'fulfilled'
            ? { status: 'fulfilled', value: r.value }
            : { status: 'rejected', reason: r.reason },
        now,
      });
    });

    return NextResponse.json(
      { activeProvider, balances },
      {
        headers: {
          'Cache-Control': 'private, max-age=10, stale-while-revalidate=20',
        },
      },
    );
  } catch (err) {
    return handleApiError(err, 'sms-providers-balances');
  }
}
