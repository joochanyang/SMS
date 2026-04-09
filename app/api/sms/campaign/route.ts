import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  KR_POLICY,
  MessageType,
  normalizeKrRecipients,
  validateAdMessageRules,
} from "@/lib/sms-policy";

type CreateCampaignBody = {
  name?: string;
  message: string;
  recipients: string[];
  messageType?: MessageType;
  costPerMessageUsd?: number;
};

function isKrAdQuietHours(date = new Date()): boolean {
  const kst = new Date(date.toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
  const hh = kst.getHours();
  const mm = kst.getMinutes();
  const minutes = hh * 60 + mm;
  // 20:50 ~ 08:00
  return minutes >= 20 * 60 + 50 || minutes < 8 * 60;
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json()) as CreateCampaignBody;
    const message = body.message?.trim();
    const recipients = normalizeKrRecipients(body.recipients ?? []);
    const messageType: MessageType = body.messageType === "AD" ? "AD" : "TRANSACTIONAL";
    const costPerMessage = Number.isFinite(body.costPerMessageUsd as number)
      ? (body.costPerMessageUsd as number)
      : KR_POLICY.defaultCostPerMessageUsd;

    if (!message) return NextResponse.json({ error: "Message is required" }, { status: 400 });
    if (recipients.length === 0) {
      return NextResponse.json(
        { error: "Korean recipient format is invalid. Use 010xxxxxxxx or +8210xxxxxxxx." },
        { status: 400 }
      );
    }
    if (!(costPerMessage > 0)) return NextResponse.json({ error: "Invalid costPerMessageUsd" }, { status: 400 });
    if (messageType === "AD") {
      const adRule = validateAdMessageRules(message);
      if (!adRule.ok) return NextResponse.json({ error: adRule.reason }, { status: 400 });
      if (isKrAdQuietHours()) {
        return NextResponse.json(
          { error: "한국 광고성 문자 발송 제한 시간(20:50~08:00)입니다. 발송 시간을 조정하세요." },
          { status: 400 }
        );
      }
    }

    const estimatedCost = recipients.length * costPerMessage;

    const campaign = await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: session.user.id } });
      if (!user) throw new Error("USER_NOT_FOUND");
      if (user.credits < estimatedCost) {
        const icErr = new Error("INSUFFICIENT_CREDITS");
        (icErr as any).required = estimatedCost;
        (icErr as any).available = user.credits;
        throw icErr;
      }

      const created = await tx.smsCampaign.create({
        data: {
          userId: user.id,
          name: body.name?.trim() || null,
          messageBody: message,
          messageType,
          status: "QUEUED",
          totalRecipients: recipients.length,
          costPerMessage,
          estimatedCost,
          dynamicBatchSize: KR_POLICY.maxBatchSize,
          tempFailureStreak: 0,
        },
      });

      await tx.smsLog.createMany({
        data: recipients.map((to) => ({
          userId: user.id,
          campaignId: created.id,
          targetNumber: to,
          messageBody: message,
          status: "PENDING",
          cost: costPerMessage,
        })),
      });

      await tx.transaction.create({
        data: {
          userId: user.id,
          amount: -estimatedCost,
          type: "WITHDRAWAL",
          description: `SMS campaign reserve (${recipients.length} recipients)`,
        },
      });

      await tx.user.update({
        where: { id: user.id },
        data: { credits: { decrement: estimatedCost } },
      });

      return created;
    });

    return NextResponse.json(
      {
        campaignId: campaign.id,
        totalRecipients: campaign.totalRecipients,
        estimatedCost: campaign.estimatedCost,
        costPerMessage: campaign.costPerMessage,
        status: campaign.status,
      },
      { status: 201 }
    );
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    if (err.message === "USER_NOT_FOUND") {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    if (err.message === "INSUFFICIENT_CREDITS") {
      return NextResponse.json(
        {
          error: "Insufficient credits",
          required: (err as any).required ?? 0,
          available: (err as any).available ?? 0,
        },
        { status: 402 }
      );
    }
    console.error("Create campaign error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const campaigns = await prisma.smsCampaign.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        name: true,
        messageType: true,
        status: true,
        totalRecipients: true,
        processedCount: true,
        deliveredCount: true,
        failedCount: true,
        costPerMessage: true,
        estimatedCost: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return NextResponse.json({ campaigns }, { status: 200 });
  } catch (e) {
    console.error("List campaigns error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

