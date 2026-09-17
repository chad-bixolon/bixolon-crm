import type { UserRole } from '@prisma/client';
declare module 'next-auth' {
  interface Session { crmUser?: { id: number; name: string; email: string; role: UserRole; active: true } }
}
declare module '@auth/core/jwt' {
  interface JWT { crmUserId?: number; crmIdentityId?: number }
}
