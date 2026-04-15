import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/api-rate-limit";

type Params = { params: Promise<{ id: string; contactId: string }> };

async function getOwnedContact(bookId: string, contactId: string, userId: string) {
  const book = await prisma.addressBook.findUnique({ where: { id: bookId } });
  if (!book || book.userId !== userId) return null;
  const contact = await prisma.contact.findUnique({ where: { id: contactId } });
  if (!contact || contact.addressBookId !== bookId) return null;
  return contact;
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const rl = await withRateLimit(req, { maxPerMinute: 20, maxPerHour: 100 });
  if (!rl.allowed) return rl.response!;

  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  }

  const { id, contactId } = await params;
  const contact = await getOwnedContact(id, contactId, session.user.id);
  if (!contact) {
    return NextResponse.json({ error: "연락처를 찾을 수 없습니다." }, { status: 404 });
  }

  const body = await req.json();
  const data: Record<string, string | null> = {};
  if (body.phone?.trim()) data.phone = body.phone.trim();
  if (body.name !== undefined) data.name = body.name?.trim() || null;
  if (body.nickname !== undefined) data.nickname = body.nickname?.trim() || null;

  await prisma.contact.update({ where: { id: contactId }, data });
  return NextResponse.json({ success: true });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  }

  const { id, contactId } = await params;
  const contact = await getOwnedContact(id, contactId, session.user.id);
  if (!contact) {
    return NextResponse.json({ error: "연락처를 찾을 수 없습니다." }, { status: 404 });
  }

  await prisma.contact.delete({ where: { id: contactId } });
  return NextResponse.json({ success: true });
}
