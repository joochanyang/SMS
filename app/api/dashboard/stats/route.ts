import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/api-rate-limit";

export async function GET(req: NextRequest) {
  try {
    // Rate limit: 분당 30회, 시간당 300회
    const rl = await withRateLimit(req, { maxPerMinute: 30, maxPerHour: 300 });
    if (!rl.allowed) return rl.response!;

    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    const userId = session.user.id;

    // 병렬로 모든 쿼리 실행
    const [user, campaignCount, statusCounts, recentCampaigns, dailyLogs] = await Promise.all([
      // 유저 크레딧 잔액
      prisma.user.findUnique({
        where: { id: userId },
        select: { credits: true, costPerMessage: true },
      }),

      // 총 캠페인 수
      prisma.smsCampaign.count({
        where: { userId },
      }),

      // 상태별 SmsLog 집계
      prisma.smsLog.groupBy({
        by: ["status"],
        where: { userId },
        _count: { id: true },
        _sum: { cost: true },
      }),

      // 최근 캠페인 5건
      prisma.smsCampaign.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: {
          id: true,
          name: true,
          status: true,
          totalRecipients: true,
          deliveredCount: true,
          failedCount: true,
          createdAt: true,
        },
      }),

      // 최근 7일 SmsLog (날짜별 그룹화를 위해 raw 데이터 가져오기)
      prisma.smsLog.findMany({
        where: {
          userId,
          createdAt: {
            gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
          },
        },
        select: {
          status: true,
          createdAt: true,
        },
      }),
    ]);

    // overview 계산
    const statusMap: Record<string, number> = {};
    let totalSpent = 0;
    for (const s of statusCounts) {
      statusMap[s.status] = s._count.id;
      totalSpent += Number(s._sum.cost ?? 0);
    }

    const totalSent = Object.values(statusMap).reduce((a, b) => a + b, 0);
    const totalDelivered = statusMap["DELIVERED"] ?? 0;
    const totalFailed = statusMap["FAILED"] ?? 0;

    const overview = {
      totalCampaigns: campaignCount,
      totalSent,
      totalDelivered,
      totalFailed,
      creditBalance: user?.credits ?? 0,
      costPerMessage: Number(user?.costPerMessage ?? 14),
      totalSpent: Math.round(totalSpent * 100) / 100,
    };

    // dailyStats: 날짜별 그룹화
    const dailyMap: Record<string, { sent: number; delivered: number; failed: number }> = {};

    // 최근 7일 날짜 키 미리 생성 (빈 날짜도 포함)
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      const key = `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
      dailyMap[key] = { sent: 0, delivered: 0, failed: 0 };
    }

    for (const log of dailyLogs) {
      const d = new Date(log.createdAt);
      const key = `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
      if (dailyMap[key]) {
        dailyMap[key].sent++;
        if (log.status === "DELIVERED") dailyMap[key].delivered++;
        if (log.status === "FAILED") dailyMap[key].failed++;
      }
    }

    const dailyStats = Object.entries(dailyMap).map(([date, counts]) => ({
      date,
      ...counts,
    }));

    // statusBreakdown
    const statusLabels: Record<string, { name: string; color: string }> = {
      DELIVERED: { name: "전달 완료", color: "#10b981" },
      SENT: { name: "발송 완료", color: "#3b82f6" },
      FAILED: { name: "실패", color: "#ef4444" },
      PENDING: { name: "대기 중", color: "#f59e0b" },
      RETRY_PENDING: { name: "재시도 대기", color: "#8b5cf6" },
    };

    const statusBreakdown = Object.entries(statusMap)
      .map(([status, value]) => ({
        name: statusLabels[status]?.name ?? status,
        value,
        color: statusLabels[status]?.color ?? "#6b7280",
      }))
      .filter((s) => s.value > 0);

    // 최근 캠페인 한국어 상태 매핑
    const campaignStatusLabels: Record<string, string> = {
      DRAFT: "초안",
      QUEUED: "대기 중",
      SCHEDULED: "예약됨",
      SENDING: "발송 중",
      COMPLETED: "완료",
      CANCELLED: "취소됨",
      FAILED: "실패",
    };

    const recentCampaignsFormatted = recentCampaigns.map((c) => ({
      ...c,
      statusLabel: campaignStatusLabels[c.status] ?? c.status,
      createdAtFormatted: new Date(c.createdAt).toLocaleDateString("ko-KR", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }),
    }));

    return NextResponse.json({
      overview,
      dailyStats,
      statusBreakdown,
      recentCampaigns: recentCampaignsFormatted,
    });
  } catch (error) {
    console.error("대시보드 통계 조회 오류:", error);
    return NextResponse.json(
      { error: "통계 데이터를 불러오는 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
