import { UserRole, type Prisma } from '@prisma/client';
import { can, type Permission } from './authorization';

// Keep assignment rules tied to the same capabilities used to edit the record.
export function eligibleUserWhere(permission: Permission): Prisma.UserWhereInput {
  return {
    active: true,
    archivedAt: null,
    role: { in: Object.values(UserRole).filter(role => can({ id: 0, role, active: true }, permission)) },
  };
}

export function eligibleUser(user: { role: UserRole; active: boolean; archivedAt: Date | null } | null, permission: Permission) {
  return !!user && can({ id: 0, ...user }, permission);
}

// Forecast and named sales-rep assignments are scoped to the sales organization.
export function activeSalesRepWhere(): Prisma.UserWhereInput {
  return { active: true, archivedAt: null, role: { in: [UserRole.SALES, UserRole.SALES_MANAGER] } };
}
