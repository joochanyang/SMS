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

    // TXG는 SMPP 워커 전담 — 동기 send-test 불가.
    // 실제 발송 검증은 SUPER_ADMIN 본인 계정으로 캠페인을 만들어 canary 번호로 1건 발송.
    if (providerName === 'txg') {
      return NextResponse.json({
        success: false,
        error: 'TXG는 SMPP 워커가 비동기 처리하므로 즉시 send-test를 지원하지 않습니다. 본인 캠페인으로 1건 발송 후 발송내역을 확인하세요.',
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
