/**
 * USDT 입금 신청 API
 * 
 * POST /api/usdt/deposit
 * 
 * 사용자가 충전할 발송건수를 입력하면 필요한 USDT 수량을 확정하고,
 * 입금 시점의 시세를 Lock합니다.
 * 시세 Lock 유효 기간: 15분 (환경변수로 설정 가능)
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/api-rate-limit";
import { getUsdtKrwPrice, krwToUsd } from "@/lib/upbit";
import { logger, toLogError } from "@/lib/logger";

function ceilToSixDecimals(value: number) {
  return Math.ceil(value * 1_000_000) / 1_000_000;
}

export async function POST(req: NextRequest) {
  try {
    // Rate limit: 분당 5회, 시간당 30회
    const rl = await withRateLimit(req, { maxPerMinute: 5, maxPerHour: 30 });
    if (!rl.allowed) return rl.response!;

    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    const body = await req.json();
    const hasMessageCount =
      body.messageCount !== undefined && body.messageCount !== null && body.messageCount !== "";
    const requestedMessageCount = hasMessageCount ? Number(body.messageCount) : null;
    let usdtAmount = parseFloat(body.usdtAmount);

    // 입력 검증
    if (hasMessageCount) {
      if (
        !requestedMessageCount ||
        !Number.isFinite(requestedMessageCount) ||
        !Number.isInteger(requestedMessageCount) ||
        requestedMessageCount <= 0
      ) {
        return NextResponse.json({ error: "유효한 발송건수를 입력하세요." }, { status: 400 });
      }

      if (requestedMessageCount > 100_000_000) {
        return NextResponse.json({ error: "최대 충전 발송건수는 100,000,000건입니다." }, { status: 400 });
      }
    } else if (!usdtAmount || isNaN(usdtAmount) || usdtAmount <= 0) {
      return NextResponse.json({ error: "유효한 USDT 수량을 입력하세요." }, { status: 400 });
    }

    // 현재 활성 입금 요청이 있는지 확인
    const activeDeposit = await prisma.usdtDeposit.findFirst({
      where: {
        userId: session.user.id,
        status: { in: ["PENDING", "SUBMITTED", "VERIFYING"] },
        expiresAt: { gt: new Date() },
      },
    });

    if (activeDeposit) {
      return NextResponse.json({
        error: "진행 중인 입금 요청이 있습니다. 기존 요청을 완료하거나 만료 후 다시 시도하세요.",
        existingDepositId: activeDeposit.id,
      }, { status: 409 });
    }

    // Upbit 시세 조회 & Lock
    const priceData = await getUsdtKrwPrice();
    const exchangeRate = priceData.price;

    if (hasMessageCount && requestedMessageCount) {
      const userForCost = await prisma.user.findUnique({
        where: { id: session.user.id },
        select: { costPerMessage: true },
      });
      const costPerMessageKrw = Number(userForCost?.costPerMessage ?? 14);
      const requiredKrw = requestedMessageCount * costPerMessageKrw;
      usdtAmount = ceilToSixDecimals(Math.max(1, requiredKrw / exchangeRate));
    }

    if (usdtAmount < 1) {
      return NextResponse.json({ error: "최소 입금 수량은 1 USDT입니다." }, { status: 400 });
    }

    if (usdtAmount > 100000) {
      return NextResponse.json({ error: "최대 입금 수량은 100,000 USDT입니다." }, { status: 400 });
    }

    const krwAmount = Math.round(usdtAmount * exchangeRate);
    const creditAmount = await krwToUsd(krwAmount);

    // 시세 Lock 유효 기간
    const expiryMinutes = parseInt(process.env.USDT_DEPOSIT_EXPIRY_MINUTES || "15");
    const expiresAt = new Date(Date.now() + expiryMinutes * 60 * 1000);

    const walletAddress = process.env.USDT_TRC20_WALLET_ADDRESS || "";

    if (!walletAddress || walletAddress === "TYourWalletAddressHere") {
      return NextResponse.json(
        { error: "시스템 지갑 주소가 설정되지 않았습니다. 관리자에게 문의하세요." },
        { status: 503 }
      );
    }

    // 입금 요청 생성
    const deposit = await prisma.usdtDeposit.create({
      data: {
        userId: session.user.id,
        usdtAmount,
        exchangeRate,
        krwAmount,
        creditAmount,
        walletAddress,
        expiresAt,
        status: "PENDING",
      },
    });

    return NextResponse.json({
      success: true,
      deposit: {
        id: deposit.id,
        usdtAmount: Number(deposit.usdtAmount),
        exchangeRate: Number(deposit.exchangeRate),
        krwAmount: Number(deposit.krwAmount),
        creditAmount: Number(deposit.creditAmount),
        walletAddress: deposit.walletAddress,
        expiresAt: deposit.expiresAt.toISOString(),
        status: deposit.status,
      },
    });
  } catch (error) {
    logger.error("[USDT Deposit] Error", { error: toLogError(error) });
    return NextResponse.json(
      { error: "입금 요청 처리 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}

/**
 * GET /api/usdt/deposit
 * 
 * 사용자의 입금 내역 조회
 */
export async function GET(req: NextRequest) {
  try {
    const rl = await withRateLimit(req, { maxPerMinute: 30, maxPerHour: 300 });
    if (!rl.allowed) return rl.response!;

    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    const deposits = await prisma.usdtDeposit.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: "desc" },
      take: 20,
    });

    return NextResponse.json({
      deposits: deposits.map((d) => ({
        id: d.id,
        usdtAmount: Number(d.usdtAmount),
        exchangeRate: Number(d.exchangeRate),
        krwAmount: Number(d.krwAmount),
        creditAmount: Number(d.creditAmount),
        walletAddress: d.walletAddress,
        txid: d.txid,
        status: d.status,
        failReason: d.failReason,
        verifiedAt: d.verifiedAt?.toISOString() || null,
        expiresAt: d.expiresAt.toISOString(),
        createdAt: d.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    logger.error("[USDT Deposit List] Error", { error: toLogError(error) });
    return NextResponse.json(
      { error: "입금 내역 조회 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
