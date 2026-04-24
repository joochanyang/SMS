import { NextResponse } from "next/server";
import { prisma } from "@shared/prisma";

export async function GET() {
  try {
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
