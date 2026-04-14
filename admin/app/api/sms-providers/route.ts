import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@shared/prisma';
import { requireAuth } from '@/lib/admin-session';
import { requirePermission } from '@/lib/rbac';
import { logAdminAction } from '@/lib/audit';
import { getAllProviders, getProviderByName } from '@shared/sms-providers/router';
import type { SmsProviderName } from '@shared/sms-providers/types';

function handleError(err: unknown): NextResponse {
  if (err instanceof Error) {
    const status = (err as any).status;
    if (status === 401 || status === 403) {
      return NextResponse.json({ error: err.message }, { status });
    }
  }
  console.error('[API] sms-providers:', err);
  return NextResponse.json({ error: '요청 처리 중 오류가 발생했습니다.' }, { status: 500 });
}

// ---------------------------------------------------------------------------
// GET /api/sms-providers — 프로바이더 목록 + 활성 프로바이더 조회
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  try {
    const admin = await requireAuth(request);
    requirePermission(admin, 'setting:read');

    const [activeSetting, configsSetting] = await Promise.all([
      prisma.systemSetting.findUnique({ where: { key: 'active_sms_provider' } }),
      prisma.systemSetting.findUnique({ where: { key: 'sms_provider_configs' } }),
    ]);

    const activeProvider = ((activeSetting?.value as any)?.provider ?? 'infobip') as string;
    const configs = (configsSetting?.value ?? {}) as Record<string, any>;

    const providers = getAllProviders().map(({ name, provider }) => ({
      name,
      isConfigured: provider.isConfigured(),
      isActive: name === activeProvider,
      enabled: configs[name]?.enabled ?? (name === 'infobip'),
      priority: configs[name]?.priority ?? 99,
      maxBatchSize: provider.maxBatchSize,
    }));

    return NextResponse.json({ providers, activeProvider });
  } catch (err) {
    return handleError(err);
  }
}

// ---------------------------------------------------------------------------
// PUT /api/sms-providers — 활성 프로바이더 변경
// ---------------------------------------------------------------------------

export async function PUT(request: NextRequest) {
  try {
    const admin = await requireAuth(request);
    requirePermission(admin, 'setting:update');

    const body = await request.json();
    const { provider, reason } = body;

    if (!provider || !reason) {
      return NextResponse.json(
        { error: '프로바이더 이름과 사유를 입력하세요.' },
        { status: 400 },
      );
    }

    const validNames: SmsProviderName[] = ['infobip', 'smsto'];
    if (!validNames.includes(provider)) {
      return NextResponse.json(
        { error: '유효하지 않은 프로바이더입니다.' },
        { status: 400 },
      );
    }

    // 설정 여부 확인
    const instance = getProviderByName(provider);
    if (!instance.isConfigured()) {
      return NextResponse.json(
        { error: `${provider} 프로바이더의 API 키가 설정되지 않았습니다.` },
        { status: 400 },
      );
    }

    const prev = await prisma.systemSetting.findUnique({
      where: { key: 'active_sms_provider' },
    });

    await prisma.systemSetting.upsert({
      where: { key: 'active_sms_provider' },
      update: {
        value: { provider },
        updatedById: admin.id,
      },
      create: {
        key: 'active_sms_provider',
        value: { provider },
        category: 'sms',
        description: '현재 활성 SMS 프로바이더',
        updatedById: admin.id,
      },
    });

    await logAdminAction(
      admin,
      'SMS_PROVIDER_CHANGE',
      'SystemSetting',
      'active_sms_provider',
      reason,
      request,
      {
        previousValue: prev?.value,
        newValue: { provider },
      },
    );

    return NextResponse.json({ success: true, activeProvider: provider });
  } catch (err) {
    return handleError(err);
  }
}
