import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/api-rate-limit";

async function getOwnedBook(bookId: string, userId: string) {
  const book = await prisma.addressBook.findUnique({
    where: { id: bookId },
    include: { _count: { select: { contacts: true } } },
  });
  if (!book || book.userId !== userId) return null;
  return book;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const rl = await withRateLimit(req, { maxPerMinute: 30, maxPerHour: 200 });
  if (!rl.allowed) return rl.response!;

  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  }

  const { id } = await params;
  const book = await getOwnedBook(id, session.user.id);
  if (!book) {
    return NextResponse.json({ error: "주소록을 찾을 수 없습니다." }, { status: 404 });
  }

  const contacts = await prisma.contact.findMany({
    where: { addressBookId: id },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({
    id: book.id,
    name: book.name,
    contactCount: book._count.contacts,
    createdAt: book.createdAt,
    contacts: contacts.map((c) => ({
      id: c.id,
      name: c.name,
      nickname: c.nickname,
      phone: c.phone,
    })),
  });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  }

  const { id } = await params;
  const book = await getOwnedBook(id, session.user.id);
  if (!book) {
    return NextResponse.json({ error: "주소록을 찾을 수 없습니다." }, { status: 404 });
  }

  const body = await req.json();
  const name = body.name?.trim();
  if (!name) {
    return NextResponse.json({ error: "주소록 이름을 입력하세요." }, { status: 400 });
  }

  await prisma.addressBook.update({ where: { id }, data: { name } });
  return NextResponse.json({ success: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  }

  const { id } = await params;
  const book = await getOwnedBook(id, session.user.id);
  if (!book) {
    return NextResponse.json({ error: "주소록을 찾을 수 없습니다." }, { status: 404 });
  }

  await prisma.addressBook.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
