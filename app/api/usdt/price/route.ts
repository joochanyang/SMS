/**
 * USDT/KRW 실시간 시세 API
 * 
 * GET /api/usdt/price
 * 
 * Upbit REST API를 통해 현재 USDT/KRW 시세를 반환합니다.
 * 클라이언트의 WebSocket 연결 실패 시 fallback으로 사용됩니다.
 */

import { NextRequest, NextResponse } from "next/server";
import { withRateLimit } from "@/lib/api-rate-limit";
import { getUsdtKrwPrice } from "@/lib/upbit";
import { logger, toLogError } from "@/lib/logger";

export async function GET(req: NextRequest) {
  try {
    // Rate limit: 분당 60회, 시간당 600회
    const rl = await withRateLimit(req, { maxPerMinute: 60, maxPerHour: 600 });
    if (!rl.allowed) return rl.response!;

    const priceData = await getUsdtKrwPrice();

    return NextResponse.json({
      market: "KRW-USDT",
      price: priceData.price,
      changeRate: priceData.changeRate,
      changePrice: priceData.changePrice,
      volume24h: priceData.volume24h,
      timestamp: priceData.timestamp,
      source: "upbit",
    });
  } catch (error) {
    logger.error("[USDT Price] Error", { error: toLogError(error) });
    return NextResponse.json(
      { error: "시세 정보를 가져올 수 없습니다." },
      { status: 503 }
    );
  }
}
