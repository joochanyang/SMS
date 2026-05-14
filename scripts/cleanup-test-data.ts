// ---------------------------------------------------------------------------
// 테스트 데이터 정리 스크립트
// 실행: npx tsx scripts/cleanup-test-data.ts
//
// 동작:
// 1. QUEUED 상태이고 가짜번호(+8200000 등)가 포함된 캠페인 탐색
// 2. 해당 캠페인의 SmsLog 삭제
// 3. 해당 캠페인의 Transaction 환불 처리 (차감된 크레딧 복구)
// 4. 해당 캠페인 삭제
//
// 주의: --dry-run 플래그로 먼저 확인 후 실행하세요.
// ---------------------------------------------------------------------------

import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const DRY_RUN = process.argv.includes("--dry-run");

// 가짜번호 패턴 (테스트에서 사용된 번호들)
const FAKE_NUMBER_PATTERNS = [
  /^\+8200000/,    // +820000012345 형태
  /^\+0000/,       // +0000... 형태
  /^00000/,        // 00000... 형태
  /^\+1555/,       // 미국 테스트 번호
];

function isFakeNumber(number: string): boolean {
  return FAKE_NUMBER_PATTERNS.some((pattern) => pattern.test(number));
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("❌ DATABASE_URL 환경변수가 설정되지 않았습니다.");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: databaseUrl });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  try {
    console.log(DRY_RUN ? "🔍 [DRY RUN 모드] 실제 삭제하지 않습니다.\n" : "⚠️  [실행 모드] 데이터가 삭제됩니다.\n");

    // 1. QUEUED 상태 캠페인 조회
    const queuedCampaigns = await prisma.smsCampaign.findMany({
      where: { status: "QUEUED" },
      include: {
        logs: { select: { id: true, targetNumber: true, cost: true } },
        user: { select: { id: true, email: true, credits: true } },
      },
    });

    console.log(`📋 QUEUED 상태 캠페인: ${queuedCampaigns.length}개\n`);

    let totalCleaned = 0;

    for (const campaign of queuedCampaigns) {
      const fakeLogs = campaign.logs.filter((log) => isFakeNumber(log.targetNumber));

      if (fakeLogs.length === 0) {
        console.log(`  ⏭ 캠페인 ${campaign.id}: 가짜번호 없음, 스킵`);
        continue;
      }

      const allFake = fakeLogs.length === campaign.logs.length;
      const refundAmount = fakeLogs.reduce((sum, log) => sum + Number(log.cost), 0);

      console.log(`  🎯 캠페인 ${campaign.id}:`);
      console.log(`     - 유저: ${campaign.user.email}`);
      console.log(`     - 전체 로그: ${campaign.logs.length}건, 가짜번호: ${fakeLogs.length}건`);
      console.log(`     - 환불 예정 금액: $${refundAmount.toFixed(2)}`);
      console.log(`     - 캠페인 ${allFake ? "전체 삭제" : "가짜번호 로그만 삭제"}`);

      if (!DRY_RUN) {
        await prisma.$transaction(async (tx) => {
          // 가짜번호 SmsLog 삭제
          await tx.smsLog.deleteMany({
            where: {
              campaignId: campaign.id,
              id: { in: fakeLogs.map((l) => l.id) },
            },
          });

          // 환불 처리: 유저 크레딧 복구
          if (refundAmount > 0) {
            await tx.user.update({
              where: { id: campaign.userId },
              data: { credits: { increment: refundAmount } },
            });

            // 환불 Transaction 기록
            await tx.transaction.create({
              data: {
                userId: campaign.userId,
                amount: refundAmount,
                type: "DEPOSIT",
                description: `테스트 데이터 정리 환불 (캠페인 ${campaign.id})`,
              },
            });
          }

          // 모든 로그가 가짜번호면 캠페인 자체 삭제
          if (allFake) {
            // 남은 SmsLog 있으면 삭제 (안전장치)
            await tx.smsLog.deleteMany({
              where: { campaignId: campaign.id },
            });
            await tx.smsCampaign.delete({
              where: { id: campaign.id },
            });
            console.log(`     ✅ 캠페인 삭제 완료`);
          } else {
            // 캠페인 통계 업데이트
            await tx.smsCampaign.update({
              where: { id: campaign.id },
              data: {
                totalRecipients: { decrement: fakeLogs.length },
                estimatedCost: { decrement: refundAmount },
              },
            });
            console.log(`     ✅ 가짜번호 로그 ${fakeLogs.length}건 삭제 완료`);
          }
        });
      }

      totalCleaned++;
    }

    console.log(`\n📊 결과: ${totalCleaned}개 캠페인 정리${DRY_RUN ? " 대상 (dry-run)" : " 완료"}`);
  } catch (error) {
    console.error("❌ 정리 중 오류 발생:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main();
