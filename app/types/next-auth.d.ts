import type { UserRole } from '@prisma/client';
declare module 'next-auth' {
  interface Session { googleHostedDomain?: string; googleEmail?: string; crmUser?: { id: number; name: string; email: string; role: UserRole; delegatedUserAdministrationEnabled?: boolean; active: true } }
}
declare module '@auth/core/jwt' {
  interface JWT { crmUserId?: number; crmIdentityId?: number; e2eUserId?: number; googleHostedDomain?: string; googleEmail?: string }
}
