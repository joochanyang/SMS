import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { infobipClient } from "@/lib/infobip";

type SmsRequestBody = {
  mode: "single" | "bulk";
  recipients: string[];
  message: string;
};

const COST_PER_MESSAGE_USD = 0.05;

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session || !session.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json()) as SmsRequestBody;

    if (!body.message || !Array.isArray(body.recipients) || body.recipients.length === 0) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }

    const uniqueRecipients = Array.from(new Set(body.recipients.map((r) => r.trim()).filter(Boolean)));
    if (uniqueRecipients.length === 0) {
      return NextResponse.json({ error: "No valid recipients" }, { status: 400 });
    }

    const estimatedCost = uniqueRecipients.length * COST_PER_MESSAGE_USD;

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    if (user.credits < estimatedCost) {
      return NextResponse.json(
        {
          error: "Insufficient credits",
          required: estimatedCost,
          available: user.credits,
        },
        { status: 402 }
      );
    }

    // 간단 버전: 일괄 발송 시도 후, 성공/실패 상관없이 로그와 차감 처리
    // 실제 Infobip SDK 사용 형태는 공식 문서를 참고해 세밀 조정 필요.
    const smsLogsData = uniqueRecipients.map((recipient) => ({
      userId: user.id,
      targetNumber: recipient,
      messageBody: body.message,
      status: "PENDING",
      cost: COST_PER_MESSAGE_USD,
    }));

    const result = await prisma.$transaction(async (tx) => {
      const createdLogs = await tx.smsLog.createMany({
        data: smsLogsData,
      });

      await tx.transaction.create({
        data: {
          userId: user.id,
          amount: -estimatedCost,
          type: "WITHDRAWAL",
          description: `SMS dispatch (${uniqueRecipients.length} recipients)`,
        },
      });

      await tx.user.update({
        where: { id: user.id },
        data: {
          credits: user.credits - estimatedCost,
        },
      });

      return createdLogs;
    });

    // TODO: Infobip SDK 연동 – 각 recipient 에 대해 실제 SMS 발송 및 messageId, status 업데이트
    // 예시용 구조만 남겨둡니다.
    try {
      await infobipClient.channels.sms.send({
        messages: uniqueRecipients.map((to) => ({
          destinations: [{ to }],
          text: body.message,
        })),
      } as any);
    } catch (e) {
      // 발송 실패 시에도 크레딧/로그는 남기고, 프론트에서 에러 메시지로 노출
      console.error("Infobip send error:", e);
      return NextResponse.json(
        {
          warning: "SMS logs created and credits deducted, but Infobip send call failed. Check server logs.",
        },
        { status: 207 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        recipients: uniqueRecipients.length,
        estimatedCost,
        prismaResult: result,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("SMS send API error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

