import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/admin-session';
import { requirePermission, requireRole } from '@/lib/rbac';
import { requireSudo } from '@/lib/sudo';
import { logAdminAction } from '@/lib/audit';
import { getProviderByName } from '@shared/sms-providers/router';
import type { SmsProviderName } from '@shared/sms-providers/types';
import { handleApiError } from '@shared/api-error';

const VALID_PROVIDER_NAMES: SmsProviderName[] = ['infobip', 'smsto', 'txg'];

// ---------------------------------------------------------------------------
// POST /api/sms-providers/send-test — 프로바이더 테스트 발송 (1건)
// SUPER_ADMIN only, sudo 재인증 필수 (실제 과금 발생)
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    const admin = await requireAuth(request);
    requireRole(admin, 'SUPER_ADMIN');
    requirePermission(admin, 'setting:update');
    await requireSudo(request, admin);

    const body = await request.json();
    const { provider: providerName, to, message } = body;

    if (!providerName || !to || !message) {
      return NextResponse.json(
        { error: '프로바이더, 수신번호, 메시지를 모두 입력하세요.' },
        { status: 400 },
      );
    }

    if (!VALID_PROVIDER_NAMES.includes(providerName)) {
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

    const results = await provider.sendBatch([{ to, text: message }]);
    const result = results[0];

    await logAdminAction(
      admin,
      'SMS_PROVIDER_TEST_SEND',
      'SystemSetting',
      providerName,
      `테스트 발송: ${to}`,
      request,
      { metadata: result },
    );

    return NextResponse.json({
      success: result?.status === 'SENT',
      result,
    });
  } catch (err) {
    return handleApiError(err, 'sms-providers/send-test');
  }
}
