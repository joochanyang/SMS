/**
 * Audit Trail System for SovereignSMS Admin Panel
 *
 * Every admin action touching credits, users, or system settings
 * is logged immutably with IP, user-agent, before/after values.
 */

import { NextRequest } from 'next/server';
import { prisma } from '@shared/prisma';
import type { Prisma } from '@prisma/client';

interface AdminUser {
  id: string;
  username: string;
  role: string;
  name: string;
}

export interface AuditParams {
  adminId: string;
  adminEmail: string;
  action: string;
  targetType: string;
  targetId?: string;
  previousValue?: Prisma.InputJsonValue;
  newValue?: Prisma.InputJsonValue;
  reason: string;
  req: NextRequest;
  result?: 'SUCCESS' | 'FAILURE';
  metadata?: Prisma.InputJsonValue;
}

import { getClientIp } from '@shared/client-ip';

/**
 * Audit 로그용 — 원본 클라이언트 주장 IP(X-Forwarded-For의 첫 번째).
 */
function extractIp(req: NextRequest): string {
  return getClientIp(req, 'claimed');
}

/**
 * Extract user-agent string from the request.
 */
function extractUserAgent(req: NextRequest): string | null {
  return req.headers.get('user-agent') ?? null;
}

/**
 * Create an immutable audit log entry.
 *
 * This function never throws — audit failures are logged to console
 * but must not break the main operation flow.
 */
export async function logAudit(params: AuditParams): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        adminId: params.adminId,
        adminEmail: params.adminEmail,
        action: params.action,
        targetType: params.targetType,
        targetId: params.targetId ?? null,
        previousValue: params.previousValue !== undefined ? params.previousValue : undefined,
        newValue: params.newValue !== undefined ? params.newValue : undefined,
        reason: params.reason,
        ipAddress: extractIp(params.req),
        userAgent: extractUserAgent(params.req),
        result: params.result ?? 'SUCCESS',
        metadata: params.metadata !== undefined ? params.metadata : undefined,
      },
    });
  } catch (err) {
    // Audit failures must not crash the main flow — log and continue
    console.error('[AUDIT] Failed to write audit log:', err, {
      action: params.action,
      adminId: params.adminId,
      targetType: params.targetType,
      targetId: params.targetId,
    });
  }
}

/**
 * Convenience wrapper — shorter signature for common admin actions.
 */
export async function logAdminAction(
  admin: AdminUser,
  action: string,
  targetType: string,
  targetId: string | undefined,
  reason: string,
  req: NextRequest,
  opts?: {
    previousValue?: Prisma.InputJsonValue;
    newValue?: Prisma.InputJsonValue;
    result?: 'SUCCESS' | 'FAILURE';
    metadata?: Prisma.InputJsonValue;
  },
): Promise<void> {
  await logAudit({
    adminId: admin.id,
    adminEmail: admin.username,
    action,
    targetType,
    targetId,
    reason,
    req,
    previousValue: opts?.previousValue,
    newValue: opts?.newValue,
    result: opts?.result,
    metadata: opts?.metadata,
  });
}
