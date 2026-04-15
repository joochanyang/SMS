import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/api-rate-limit";

async function verifyOwnership(bookId: string, userId: string) {
  const book = await prisma.addressBook.findUnique({ where: { id: bookId } });
  return book && book.userId === userId;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  }

  const { id } = await params;
  if (!(await verifyOwnership(id, session.user.id))) {
    return NextResponse.json({ error: "주소록을 찾을 수 없습니다." }, { status: 404 });
  }

  const contacts = await prisma.contact.findMany({
    where: { addressBookId: id },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, nickname: true, phone: true },
  });

  return NextResponse.json({ contacts });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const rl = await withRateLimit(req, { maxPerMinute: 10, maxPerHour: 50 });
  if (!rl.allowed) return rl.response!;

  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  }

  const { id } = await params;
  if (!(await verifyOwnership(id, session.user.id))) {
    return NextResponse.json({ error: "주소록을 찾을 수 없습니다." }, { status: 404 });
  }

  const body = await req.json();

  // 단일 연락처 또는 배열(CSV 임포트)
  const items: Array<{ phone: string; name?: string; nickname?: string }> = Array.isArray(body.contacts) ? body.contacts : [body];

  const valid = items.filter((c) => c.phone?.trim());
  if (valid.length === 0) {
    return NextResponse.json({ error: "유효한 연락처가 없습니다." }, { status: 400 });
  }

  // 벌크 임포트 최대 1000건 제한
  if (valid.length > 1000) {
    return NextResponse.json({ error: "한 번에 최대 1,000건까지 추가할 수 있습니다." }, { status: 400 });
  }

  await prisma.contact.createMany({
    data: valid.map((c) => ({
      addressBookId: id,
      phone: c.phone.trim(),
      name: c.name?.trim() || null,
      nickname: c.nickname?.trim() || null,
    })),
  });

  return NextResponse.json({ imported: valid.length }, { status: 201 });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  }

  const { id } = await params;
  if (!(await verifyOwnership(id, session.user.id))) {
    return NextResponse.json({ error: "주소록을 찾을 수 없습니다." }, { status: 404 });
  }

  const body = await req.json();
  const contactIds: string[] = body.contactIds;
  if (!contactIds?.length) {
    return NextResponse.json({ error: "삭제할 연락처를 선택하세요." }, { status: 400 });
  }

  await prisma.contact.deleteMany({
    where: { id: { in: contactIds }, addressBookId: id },
  });

  return NextResponse.json({ success: true });
}
