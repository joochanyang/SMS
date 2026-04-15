import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@shared/prisma';
import { requireAuth } from '@/lib/admin-session';
import { requirePermission } from '@/lib/rbac';
import { logAdminAction } from '@/lib/audit';
import { requireSudo } from '@/lib/sudo';
import { sendAlert } from '@/lib/notifications';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const killSwitchSchema = z.object({
  level: z.enum(['NORMAL', 'GLOBAL_PAUSE', 'GLOBAL_STOP']),
  reason: z.string().min(5, '사유를 5자 이상 입력하세요.'),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function handleError(err: unknown): NextResponse {
  if (err instanceof Error) {
    const status = (err as any).status;
    if (status === 401 || status === 403) {
      const response: any = { error: err.message };
      if ((err as any).requireSudo) response.requireSudo = true;
      return NextResponse.json(response, { status });
    }
  }
  console.error('[API] settings/kill-switch:', err);
  return NextResponse.json({ error: '요청 처리 중 오류가 발생했습니다.' }, { status: 500 });
}

// ---------------------------------------------------------------------------
// GET /api/settings/kill-switch — Current kill switch status
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  try {
    const admin = await requireAuth(request);

    const setting = await prisma.systemSetting.findUnique({
      where: { key: 'kill_switch' },
    });

    const level = setting?.value ?? 'NORMAL';

    return NextResponse.json({
      level: typeof level === 'object' && level !== null && 'level' in level
        ? (level as any).level
        : level,
      updatedAt: setting?.updatedAt ?? null,
      updatedById: setting?.updatedById ?? null,
    });
  } catch (err) {
    return handleError(err);
  }
}

// ---------------------------------------------------------------------------
// POST /api/settings/kill-switch — Toggle kill switch
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    const admin = await requireAuth(request);
    requirePermission(admin, 'killswitch:toggle');

    // Sudo required
    await requireSudo(request, admin);

    const body = await request.json();
    const parsed = killSwitchSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: '입력값이 올바르지 않습니다.', details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      );
    }

    const { level, reason } = parsed.data;

    // Get current level for audit
    const currentSetting = await prisma.systemSetting.findUnique({
      where: { key: 'kill_switch' },
    });
    const previousLevel = currentSetting?.value ?? 'NORMAL';

    // Update system setting
    await prisma.systemSetting.upsert({
      where: { key: 'kill_switch' },
      create: {
        key: 'kill_switch',
        value: { level, reason, activatedAt: new Date().toISOString(), activatedBy: admin.username },
        category: 'system',
        description: '킬 스위치 상태',
        updatedById: admin.id,
      },
      update: {
        value: { level, reason, activatedAt: new Date().toISOString(), activatedBy: admin.username },
        updatedById: admin.id,
      },
    });

    let stoppedCampaigns = 0;

    // GLOBAL_STOP: stop ALL active campaigns
    if (level === 'GLOBAL_STOP') {
      const activeCampaigns = await prisma.smsCampaign.findMany({
        where: { status: { in: ['QUEUED', 'SENDING'] } },
        select: { id: true, userId: true, costPerMessage: true, name: true },
      });

      for (const campaign of activeCampaigns) {
        await prisma.$transaction(async (tx) => {
          // Cancel pending messages
          const cancelResult = await tx.smsLog.updateMany({
            where: {
              campaignId: campaign.id,
              status: { in: ['PENDING', 'RETRY_PENDING'] },
            },
            data: { status: 'FAILED', providerError: '관리자 킬 스위치에 의한 중지' },
          });

          const refundAmount = cancelResult.count * Number(campaign.costPerMessage);

          if (refundAmount > 0) {
            const user = await tx.user.findUnique({
              where: { id: campaign.userId },
              select: { credits: true },
            });

            if (user) {
              const newBalance = Number(user.credits) + refundAmount;

              await tx.user.update({
                where: { id: campaign.userId },
                data: { credits: { increment: refundAmount } },
              });

              await tx.creditLedger.create({
                data: {
                  userId: campaign.userId,
                  type: 'REFUND',
                  amount: refundAmount,
                  balanceAfter: newBalance,
                  description: `킬 스위치 GLOBAL_STOP 환불 (캠페인: ${campaign.name ?? campaign.id})`,
                  adminId: admin.id,
                  referenceType: 'CAMPAIGN',
                  referenceId: campaign.id,
                },
              });

              await tx.transaction.create({
                data: {
                  userId: campaign.userId,
                  amount: refundAmount,
                  type: 'DEPOSIT',
                  description: `[킬스위치 환불] ${campaign.name ?? campaign.id}`,
                },
              });
            }
          }

          await tx.smsCampaign.update({
            where: { id: campaign.id },
            data: { status: 'CANCELLED' },
          });
        });

        stoppedCampaigns++;
      }
    }

    // Audit log
    await logAdminAction(
      admin,
      'KILL_SWITCH',
      'SystemSetting',
      'kill_switch',
      reason,
      request,
      {
        previousValue: previousLevel,
        newValue: { level, reason },
        metadata: { stoppedCampaigns },
      },
    );

    // Alert
    await sendAlert(
      `킬 스위치 변경: ${level} (사유: ${reason}). 관리자: ${admin.username}${stoppedCampaigns > 0 ? `. 중지된 캠페인: ${stoppedCampaigns}건` : ''}`,
      'CRITICAL',
    );

    return NextResponse.json({
      success: true,
      level,
      stoppedCampaigns,
    });
  } catch (err) {
    return handleError(err);
  }
}
