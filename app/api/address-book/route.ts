import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/api-rate-limit";

export async function GET(req: NextRequest) {
  const rl = await withRateLimit(req, { maxPerMinute: 30, maxPerHour: 200 });
  if (!rl.allowed) return rl.response!;

  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  }

  const books = await prisma.addressBook.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { contacts: true } } },
  });

  return NextResponse.json({
    addressBooks: books.map((b) => ({
      id: b.id,
      name: b.name,
      contactCount: b._count.contacts,
      createdAt: b.createdAt,
    })),
  });
}

export async function POST(req: NextRequest) {
  const rl = await withRateLimit(req, { maxPerMinute: 10, maxPerHour: 50 });
  if (!rl.allowed) return rl.response!;

  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  }

  const body = await req.json();
  const name = body.name?.trim();
  if (!name) {
    return NextResponse.json({ error: "주소록 이름을 입력하세요." }, { status: 400 });
  }

  const book = await prisma.addressBook.create({
    data: { userId: session.user.id, name },
  });

  return NextResponse.json({ id: book.id, name: book.name }, { status: 201 });
}
