import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@shared/prisma';
import { requireAuth } from '@/lib/admin-session';
import { requirePermission } from '@/lib/rbac';
import { handleApiError } from '@shared/api-error';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function maskPhone(phone: string): string {
  if (!phone || phone.length < 8) return '***';
  return phone.slice(0, 3) + '-****-' + phone.slice(-4);
}

function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return '***';
  const masked = local.length <= 2 ? '*'.repeat(local.length) : local.slice(0, 2) + '*'.repeat(local.length - 2);
  return `${masked}@${domain}`;
}


// ---------------------------------------------------------------------------
// GET /api/campaigns/[id] — Campaign detail
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAuth(req);
    requirePermission(admin, 'campaign:read');
    const { id } = await context.params;

    const campaign = await prisma.smsCampaign.findUnique({
      where: { id },
      include: {
        user: {
          select: { id: true, email: true, name: true, status: true },
        },
      },
    });

    if (!campaign) {
      return NextResponse.json({ error: '캠페인을 찾을 수 없습니다.' }, { status: 404 });
    }

    // Get message logs with masked phone numbers
    const logs = await prisma.smsLog.findMany({
      where: { campaignId: id },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true,
        targetNumber: true,
        status: true,
        cost: true,
        providerStatus: true,
        providerError: true,
        networkName: true, // 라우팅 통신사 (DLR 기반)
        hlrCheckedAt: true, // HLR 보강 완료 시각
        retryCount: true,
        createdAt: true,
      },
    });

    // HLR 캐시 조인 — HlrLookup은 phone(E.164) 키. SmsLog.targetNumber도 E.164라 직접 매칭.
    const uniquePhones = Array.from(new Set(logs.map((l) => l.targetNumber)));
    const hlrRows = uniquePhones.length
      ? await prisma.hlrLookup.findMany({
          where: { phone: { in: uniquePhones } },
          select: { phone: true, carrierName: true, ported: true },
        })
      : [];
    const hlrByPhone = new Map(hlrRows.map((h) => [h.phone, h]));

    const maskedLogs = logs.map((log) => {
      const hlr = hlrByPhone.get(log.targetNumber) ?? null;
      return {
        ...log,
        targetNumber: maskPhone(log.targetNumber),
        hlrCarrier: hlr?.carrierName ?? null, // HLR 정확 통신사
        hlrPorted: hlr?.ported ?? false, // 번호이동(MNP) 여부
      };
    });

    // Stats summary
    const statusCounts = await prisma.smsLog.groupBy({
      by: ['status'],
      where: { campaignId: id },
      _count: { status: true },
    });

    const stats = statusCounts.reduce(
      (acc, item) => {
        acc[item.status] = item._count.status;
        return acc;
      },
      {} as Record<string, number>,
    );

    return NextResponse.json({
      campaign: {
        ...campaign,
        user: {
          ...campaign.user,
          email: campaign.user.email ? maskEmail(campaign.user.email) : null,
        },
      },
      logs: maskedLogs,
      stats,
    });
  } catch (err) {
    return handleApiError(err, 'campaigns/[id]');
  }
}
