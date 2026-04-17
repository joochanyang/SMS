/**
 * TXID 검증 및 자동 충전 API
 * 
 * POST /api/usdt/verify
 * 
 * 사용자가 송금 후 TXID를 입력하면:
 * 1. DB에서 입금 요청(deposit) 조회
 * 2. TXID 중복 체크
 * 3. TronGrid/TronScan API로 블록체인 검증
 *    - Status: SUCCESS
 *    - To Address: 시스템 관리자 주소
 *    - Asset: USDT (TRC20)
 *    - Amount: 신청 수량과 일치
 * 4. 모든 조건 충족 시 즉시 크레딧 충전
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/api-rate-limit";
import { verifyTRC20Transaction } from "@/lib/tron-verify";
import { logger, toLogError } from "@/lib/logger";

export async function POST(req: NextRequest) {
  try {
    // Rate limit: 분당 3회, 시간당 20회 (블록체인 API 보호)
    const rl = await withRateLimit(req, { maxPerMinute: 3, maxPerHour: 20 });
    if (!rl.allowed) return rl.response!;

    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    const body = await req.json();
    const depositId = body.depositId as string;
    const txid = (body.txid as string)?.trim();

    // 입력 검증
    if (!depositId || !txid) {
      return NextResponse.json(
        { error: "입금 요청 ID와 TXID를 모두 입력해야 합니다." },
        { status: 400 }
      );
    }

    // TXID 형식 검증 (64자 hex)
    const txidClean = txid.toLowerCase().replace(/^0x/, '');
    if (!/^[a-f0-9]{64}$/.test(txidClean)) {
      return NextResponse.json(
        { error: "유효하지 않은 TXID 형식입니다. 64자리 16진수 해시를 입력해 주세요." },
        { status: 400 }
      );
    }

    // 1. 입금 요청 조회
    const deposit = await prisma.usdtDeposit.findFirst({
      where: {
        id: depositId,
        userId: session.user.id,
      },
    });

    if (!deposit) {
      return NextResponse.json({ error: "입금 요청을 찾을 수 없습니다." }, { status: 404 });
    }

    if (deposit.status === "CONFIRMED") {
      return NextResponse.json({ error: "이미 충전이 완료된 요청입니다." }, { status: 409 });
    }

    if (deposit.status === "FAILED") {
      return NextResponse.json({ error: "실패한 입금 요청입니다. 새로운 요청을 생성해 주세요." }, { status: 409 });
    }

    // 만료 확인 (시세 Lock 유효 기간)
    if (new Date() > deposit.expiresAt) {
      await prisma.usdtDeposit.update({
        where: { id: deposit.id },
        data: { status: "EXPIRED", failReason: "시세 Lock 유효 기간이 만료되었습니다." },
      });
      return NextResponse.json(
        { error: "입금 요청이 만료되었습니다. 새로운 요청을 생성해 주세요." },
        { status: 410 }
      );
    }

    // 2. TXID 중복 체크
    const existingTx = await prisma.usdtDeposit.findFirst({
      where: { txid: txidClean },
    });

    if (existingTx) {
      return NextResponse.json(
        { error: "이미 처리된 트랜잭션입니다. (TXID 중복)" },
        { status: 409 }
      );
    }

    // 상태를 VERIFYING으로 업데이트 (DB unique constraint로 레이스 컨디션 방어)
    const previousStatus = deposit.status;
    try {
      await prisma.usdtDeposit.update({
        where: { id: deposit.id },
        data: { status: "VERIFYING", txid: txidClean },
      });
    } catch (err: any) {
      // P2002: Unique constraint violation — 동시 요청으로 같은 TXID가 먼저 할당됨
      if (err?.code === "P2002") {
        return NextResponse.json(
          { error: "이미 처리된 트랜잭션입니다." },
          { status: 409 }
        );
      }
      throw err;
    }

    // 3. 블록체인 검증 — 예외 발생 시 VERIFYING 상태에서 원상복구
    let verification;
    try {
      verification = await verifyTRC20Transaction(
        txidClean,
        deposit.walletAddress,
        Number(deposit.usdtAmount),
      );
    } catch (err) {
      // 블록체인 API 호출 실패 시 이전 상태로 롤백하여 재시도 가능하게 함
      await prisma.usdtDeposit.update({
        where: { id: deposit.id },
        data: {
          status: previousStatus,
          txid: null,
          failReason: "블록체인 검증 중 오류 발생. 잠시 후 다시 시도해 주세요.",
        },
      });
      throw err;
    }

    if (!verification.valid) {
      // 검증 실패
      await prisma.usdtDeposit.update({
        where: { id: deposit.id },
        data: {
          status: verification.status === "PENDING" ? "SUBMITTED" : "FAILED",
          failReason: verification.error,
        },
      });

      return NextResponse.json({
        success: false,
        status: verification.status,
        error: verification.error,
        // PENDING인 경우 재시도 안내
        retryable: verification.status === "PENDING",
      }, { status: verification.status === "PENDING" ? 202 : 422 });
    }

    // 4. 모든 검증 통과 → 즉시 충전!
    const result = await prisma.$transaction(async (tx) => {
      // 입금 상태 업데이트
      const updatedDeposit = await tx.usdtDeposit.update({
        where: { id: deposit.id },
        data: {
          status: "CONFIRMED",
          txid: txidClean,
          verifiedAt: new Date(),
        },
      });

      // 유저 크레딧 충전
      const updatedUser = await tx.user.update({
        where: { id: session.user.id },
        data: { credits: { increment: deposit.creditAmount } },
      });

      // 트랜잭션 기록
      await tx.transaction.create({
        data: {
          userId: session.user.id,
          amount: deposit.creditAmount,
          type: "DEPOSIT",
          description: `USDT 충전: ${Number(deposit.usdtAmount)} USDT → $${Number(deposit.creditAmount)} (환율: ₩${Number(deposit.exchangeRate).toLocaleString()})`,
        },
      });

      // CreditLedger 기록
      await tx.creditLedger.create({
        data: {
          userId: session.user.id,
          type: "USDT_DEPOSIT",
          amount: deposit.creditAmount,
          balanceAfter: updatedUser.credits,
          referenceType: "UsdtDeposit",
          referenceId: deposit.id,
          description: `USDT 자동 충전: ${Number(deposit.usdtAmount)} USDT (TXID: ${txidClean.slice(0, 8)}...)`,
          idempotencyKey: `usdt-deposit-${deposit.id}`,
        },
      });

      return {
        creditAmount: Number(deposit.creditAmount),
        newBalance: Number(updatedUser.credits),
        usdtAmount: Number(deposit.usdtAmount),
        exchangeRate: Number(deposit.exchangeRate),
      };
    });

    return NextResponse.json({
      success: true,
      status: "CONFIRMED",
      message: "충전이 완료되었습니다!",
      data: {
        creditAmount: result.creditAmount,
        newBalance: result.newBalance,
        usdtAmount: result.usdtAmount,
        exchangeRate: result.exchangeRate,
        txid: txidClean,
        fromAddress: verification.fromAddress,
      },
    });
  } catch (error) {
    logger.error("[USDT Verify] Error", { error: toLogError(error) });
    return NextResponse.json(
      { error: "검증 처리 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
