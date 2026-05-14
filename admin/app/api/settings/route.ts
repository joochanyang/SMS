import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@shared/prisma';
import { requireAuth } from '@/lib/admin-session';
import { requirePermission } from '@/lib/rbac';
import { logAdminAction } from '@/lib/audit';
import { requireSudo } from '@/lib/sudo';
import { handleApiError } from '@shared/api-error';
import type { Prisma } from '@prisma/client';

type SettingListItem = {
  key: string;
  value: Prisma.JsonValue | string;
  description: string | null;
  isSensitive: boolean;
  updatedAt: Date;
  updatedById: string | null;
};

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const updateSettingSchema = z.object({
  key: z.string().min(1, '설정 키를 입력하세요.'),
  value: z.any(),
  reason: z.string().min(5, '사유를 5자 이상 입력하세요.'),
});


// ---------------------------------------------------------------------------
// GET /api/settings — All system settings grouped by category
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  try {
    const admin = await requireAuth(request);
    requirePermission(admin, 'setting:read');

    const settings = await prisma.systemSetting.findMany({
      orderBy: [{ category: 'asc' }, { key: 'asc' }],
    });

    // Group by category
    const grouped: Record<string, SettingListItem[]> = {};
    for (const s of settings) {
      if (!grouped[s.category]) grouped[s.category] = [];
      grouped[s.category].push({
        key: s.key,
        value: s.isSensitive ? '********' : s.value,
        description: s.description,
        isSensitive: s.isSensitive,
        updatedAt: s.updatedAt,
        updatedById: s.updatedById,
      });
    }

    return NextResponse.json({ settings: grouped });
  } catch (err) {
    return handleApiError(err, 'settings');
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/settings — Update a setting
// ---------------------------------------------------------------------------

export async function PATCH(request: NextRequest) {
  try {
    const admin = await requireAuth(request);
    requirePermission(admin, 'setting:update');
    await requireSudo(request, admin);

    const body = await request.json();
    const parsed = updateSettingSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: '입력값이 올바르지 않습니다.', details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      );
    }

    const { key, value, reason } = parsed.data;
    if (key === 'kill_switch' || key === 'active_sms_provider') {
      return NextResponse.json(
        { error: '이 설정은 전용 관리 화면에서만 변경할 수 있습니다.' },
        { status: 400 },
      );
    }

    // Get current value for audit
    const current = await prisma.systemSetting.findUnique({
      where: { key },
    });

    if (!current) {
      return NextResponse.json({ error: '존재하지 않는 설정입니다.' }, { status: 404 });
    }

    const updated = await prisma.systemSetting.update({
      where: { key },
      data: {
        value,
        updatedById: admin.id,
      },
    });

    await logAdminAction(
      admin,
      'SETTING_UPDATE',
      'SystemSetting',
      key,
      reason,
      request,
      {
        previousValue: current.isSensitive ? '[SENSITIVE]' : (current.value as Prisma.InputJsonValue),
        newValue: current.isSensitive ? '[SENSITIVE]' : (value as Prisma.InputJsonValue),
      },
    );

    return NextResponse.json({
      success: true,
      setting: {
        key: updated.key,
        value: updated.isSensitive ? '********' : updated.value,
        updatedAt: updated.updatedAt,
      },
    });
  } catch (err) {
    return handleApiError(err, 'settings');
  }
}
