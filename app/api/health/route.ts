// ---------------------------------------------------------------------------
// 헬스체크 엔드포인트 — DB 연결 및 대기 캠페인 수 확인
// 인증 불필요 (공개 엔드포인트)
// ---------------------------------------------------------------------------

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    // DB 연결 확인
    await prisma.$queryRaw`SELECT 1`;

    return NextResponse.json({
      status: "ok",
      timestamp: new Date().toISOString(),
    });
  } catch {
    return NextResponse.json(
      { status: "error", message: "서비스 점검 중입니다." },
      { status: 503 },
    );
  }
}
