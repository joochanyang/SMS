/**
 * RBAC (Role-Based Access Control) for SovereignSMS Admin Panel
 *
 * 4 roles: SUPER_ADMIN > ADMIN > SUPPORT > VIEWER
 * Credits = real money — permission checks are mandatory.
 */

export type Permission =
  | 'user:read' | 'user:create' | 'user:update' | 'user:delete' | 'user:suspend'
  | 'credit:read' | 'credit:adjust_small' | 'credit:adjust_large'
  | 'campaign:read' | 'campaign:stop'
  | 'blacklist:read' | 'blacklist:manage'
  | 'template:read' | 'template:review'
  | 'setting:read' | 'setting:update'
  | 'admin:read' | 'admin:manage'
  | 'audit:read'
  | 'killswitch:toggle'
  | 'dashboard:read';

export type AdminRole = 'SUPER_ADMIN' | 'ADMIN' | 'SUPPORT' | 'VIEWER';

interface AdminUser {
  id: string;
  email: string;
  role: string;
  name: string;
}

type PermissionError = Error & {
  status?: number;
  code?: 'FORBIDDEN';
  requiredPermission?: Permission;
  requiredRole?: AdminRole;
};

/** Role hierarchy — higher index = more powerful */
const ROLE_HIERARCHY: AdminRole[] = ['VIEWER', 'SUPPORT', 'ADMIN', 'SUPER_ADMIN'];

/** Complete permission matrix */
const ROLE_PERMISSIONS: Record<AdminRole, readonly Permission[]> = {
  SUPER_ADMIN: [
    'user:read', 'user:create', 'user:update', 'user:delete', 'user:suspend',
    'credit:read', 'credit:adjust_small', 'credit:adjust_large',
    'campaign:read', 'campaign:stop',
    'blacklist:read', 'blacklist:manage',
    'template:read', 'template:review',
    'setting:read', 'setting:update',
    'admin:read', 'admin:manage',
    'audit:read',
    'killswitch:toggle',
    'dashboard:read',
  ],
  ADMIN: [
    'user:read', 'user:create', 'user:update', 'user:suspend',
    'credit:read', 'credit:adjust_small',
    'campaign:read', 'campaign:stop',
    'blacklist:read', 'blacklist:manage',
    'template:read', 'template:review',
    'setting:read',
    'audit:read', // own only — enforced at query level
    'dashboard:read',
  ],
  SUPPORT: [
    'user:read',
    'credit:read',
    'campaign:read',
    'blacklist:read',
    'template:read',
    'dashboard:read',
  ],
  VIEWER: [
    'dashboard:read',
  ],
} as const;

/**
 * Check if a role has a specific permission.
 */
export function hasPermission(role: string, permission: Permission): boolean {
  const perms = ROLE_PERMISSIONS[role as AdminRole];
  if (!perms) return false;
  return perms.includes(permission);
}

/**
 * Throw 403 if the admin lacks the required permission.
 */
export function requirePermission(admin: AdminUser, permission: Permission): void {
  if (!hasPermission(admin.role, permission)) {
    const error = new Error(`권한 부족: ${permission} 권한이 필요합니다.`) as PermissionError;
    error.status = 403;
    error.code = 'FORBIDDEN';
    error.requiredPermission = permission;
    throw error;
  }
}

/**
 * Throw 403 if the admin's role is below the minimum required role.
 */
export function requireRole(admin: AdminUser, minRole: AdminRole): void {
  const adminIdx = ROLE_HIERARCHY.indexOf(admin.role as AdminRole);
  const requiredIdx = ROLE_HIERARCHY.indexOf(minRole);

  if (adminIdx === -1 || adminIdx < requiredIdx) {
    const error = new Error(`권한 부족: 최소 ${minRole} 역할이 필요합니다.`) as PermissionError;
    error.status = 403;
    error.code = 'FORBIDDEN';
    error.requiredRole = minRole;
    throw error;
  }
}

/**
 * Get all permissions for a role.
 */
export function getPermissions(role: string): Permission[] {
  const perms = ROLE_PERMISSIONS[role as AdminRole];
  if (!perms) return [];
  return [...perms];
}

/**
 * Check if roleA is at least as powerful as roleB.
 */
export function isRoleAtLeast(roleA: string, roleB: AdminRole): boolean {
  const idxA = ROLE_HIERARCHY.indexOf(roleA as AdminRole);
  const idxB = ROLE_HIERARCHY.indexOf(roleB);
  return idxA !== -1 && idxA >= idxB;
}
