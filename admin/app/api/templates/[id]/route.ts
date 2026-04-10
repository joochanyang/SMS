import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@shared/prisma';
import { requireAuth } from '@/lib/admin-session';
import { requirePermission } from '@/lib/rbac';
import { logAdminAction } from '@/lib/audit';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function handleError(err: unknown): NextResponse {
  if (err instanceof Error) {
    const status = (err as any).status;
    if (status === 401 || status === 403) {
      return NextResponse.json({ error: err.message }, { status });
    }
  }
  console.error('[API] templates/[id]:', err);
  return NextResponse.json({ error: '요청 처리 중 오류가 발생했습니다.' }, { status: 500 });
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const reviewSchema = z.object({
  action: z.enum(['APPROVE', 'REJECT']),
  rejectReason: z.string().min(5, '거절 사유를 5자 이상 입력하세요.').optional(),
});

// ---------------------------------------------------------------------------
// GET /api/templates/[id] — Template detail
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAuth(req);
    requirePermission(admin, 'template:read');
    const { id } = await context.params;

    const template = await prisma.messageTemplate.findUnique({
      where: { id },
      include: {
        user: {
          select: { id: true, email: true, name: true },
        },
      },
    });

    if (!template) {
      return NextResponse.json({ error: '템플릿을 찾을 수 없습니다.' }, { status: 404 });
    }

    return NextResponse.json({ template });
  } catch (err) {
    return handleError(err);
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/templates/[id] — Approve or reject template
// ---------------------------------------------------------------------------

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAuth(req);
    requirePermission(admin, 'template:review');
    const { id } = await context.params;

    const body = await req.json();
    const parsed = reviewSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: '입력값이 올바르지 않습니다.', details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      );
    }

    const { action, rejectReason } = parsed.data;

    const template = await prisma.messageTemplate.findUnique({ where: { id } });
    if (!template) {
      return NextResponse.json({ error: '템플릿을 찾을 수 없습니다.' }, { status: 404 });
    }

    if (template.status !== 'PENDING') {
      return NextResponse.json(
        { error: `현재 상태(${template.status})에서는 검토할 수 없습니다. 대기 중인 템플릿만 검토 가능합니다.` },
        { status: 400 },
      );
    }

    if (action === 'REJECT' && !rejectReason) {
      return NextResponse.json({ error: '거절 사유를 입력하세요.' }, { status: 400 });
    }

    const now = new Date();
    const newStatus = action === 'APPROVE' ? 'APPROVED' : 'REJECTED';

    const updated = await prisma.messageTemplate.update({
      where: { id },
      data: {
        status: newStatus,
        reviewedById: admin.id,
        reviewedAt: now,
        ...(action === 'REJECT' && { rejectReason }),
      },
    });

    await logAdminAction(
      admin,
      `TEMPLATE_${action}`,
      'MessageTemplate',
      id,
      action === 'APPROVE' ? '템플릿 승인' : `템플릿 거절: ${rejectReason}`,
      req,
      {
        previousValue: { status: template.status },
        newValue: { status: newStatus, rejectReason: rejectReason ?? null },
      },
    );

    return NextResponse.json({
      template: updated,
      message: action === 'APPROVE' ? '템플릿이 승인되었습니다.' : '템플릿이 거절되었습니다.',
    });
  } catch (err) {
    return handleError(err);
  }
}
