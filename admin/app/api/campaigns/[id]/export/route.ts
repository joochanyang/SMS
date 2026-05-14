import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@shared/prisma';
import { requireAuth } from '@/lib/admin-session';
import { requirePermission } from '@/lib/rbac';
import { logAdminAction } from '@/lib/audit';

const MAX_EXPORT_ROWS = 50_000;

// ---------------------------------------------------------------------------
// GET /api/campaigns/[id]/export — CSV 내보내기 (전체 발송 로그)
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAuth(req);
    requirePermission(admin, 'campaign:read');
    const { id } = await context.params;

    const campaign = await prisma.smsCampaign.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        status: true,
        messageBody: true,
        user: { select: { name: true, email: true } },
      },
    });

    if (!campaign) {
      return NextResponse.json({ error: '캠페인을 찾을 수 없습니다.' }, { status: 404 });
    }

    const totalLogs = await prisma.smsLog.count({ where: { campaignId: id } });
    if (totalLogs > MAX_EXPORT_ROWS) {
      await logAdminAction(
        admin,
        'CAMPAIGN_EXPORT_DENIED',
        'SmsCampaign',
        id,
        `CSV 내보내기 제한 초과: ${totalLogs}건`,
        req,
        {
          result: 'FAILURE',
          metadata: { totalLogs, maxExportRows: MAX_EXPORT_ROWS },
        },
      );

      return NextResponse.json(
        { error: `CSV 내보내기는 최대 ${MAX_EXPORT_ROWS.toLocaleString('ko-KR')}건까지 가능합니다. 현재 ${totalLogs.toLocaleString('ko-KR')}건입니다.` },
        { status: 413 },
      );
    }

    // 전체 로그 조회 (상한 적용)
    const logs = await prisma.smsLog.findMany({
      where: { campaignId: id },
      orderBy: { createdAt: 'asc' },
      select: {
        targetNumber: true,
        messageBody: true,
        status: true,
        providerStatus: true,
        networkName: true,
        networkCode: true,
        cost: true,
        retryCount: true,
        providerError: true,
        createdAt: true,
      },
    });

    // 상태 한국어 매핑
    const statusLabels: Record<string, string> = {
      PENDING: '대기 중',
      SENT: '발송 완료',
      DELIVERED: '전달 완료',
      FAILED: '실패',
      RETRY_PENDING: '재시도 대기',
      CANCELLED: '취소',
    };

    // 전화번호 마스킹 (앞 4자리 + 뒤 2자리 표시, 나머지 *)
    function maskPhone(phone: string): string {
      if (phone.length <= 6) return phone;
      const prefix = phone.slice(0, 4);
      const suffix = phone.slice(-2);
      const masked = '*'.repeat(phone.length - 6);
      return `${prefix}${masked}${suffix}`;
    }

    // CSV 생성 (BOM 포함 — 엑셀 한국어 호환)
    const BOM = '\uFEFF';
    // CSV 이스케이프 헬퍼
    function csvEscape(value: string): string {
      if (value.includes(',') || value.includes('"') || value.includes('\n')) {
        return `"${value.replace(/"/g, '""')}"`;
      }
      return value;
    }

    const headers = ['번호', '수신번호', '발송내용', '상태', '통신사', '통신사코드', '비용(KRW)', '재시도', '오류', '발송시간'];
    const csvRows = [headers.join(',')];

    for (let i = 0; i < logs.length; i++) {
      const log = logs[i];
      const row = [
        String(i + 1),
        maskPhone(log.targetNumber),
        csvEscape(log.messageBody),
        statusLabels[log.status] ?? log.status,
        log.networkName ?? '',
        log.networkCode ?? '',
        Number(log.cost).toFixed(4),
        String(log.retryCount),
        csvEscape(log.providerError ?? ''),
        new Date(log.createdAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }),
      ];
      csvRows.push(row.join(','));
    }

    const csvContent = BOM + csvRows.join('\n');

    // 파일명: 캠페인이름_날짜.csv
    const safeName = (campaign.name ?? '캠페인').replace(/[^\w가-힣\s-]/g, '').trim() || '캠페인';
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const filename = `${safeName}_${dateStr}.csv`;

    await logAdminAction(
      admin,
      'CAMPAIGN_EXPORT',
      'SmsCampaign',
      id,
      `CSV 내보내기: ${campaign.name ?? id}`,
      req,
      {
        metadata: {
          totalLogs,
          campaignName: campaign.name,
          campaignStatus: campaign.status,
          userEmail: campaign.user.email,
        },
      },
    );

    return new NextResponse(csvContent, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
      },
    });
  } catch (err) {
    if (err instanceof Error) {
      const status = (err as { status?: number }).status;
      if (status === 401 || status === 403) {
        return NextResponse.json({ error: err.message }, { status });
      }
    }
    console.error('[API] campaigns/[id]/export:', err);
    return NextResponse.json({ error: '내보내기 처리 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
