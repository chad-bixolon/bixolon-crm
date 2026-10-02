import type { PrismaClient, UserRole } from '@prisma/client';

export const DEV_IMPERSONATION_COOKIE = 'saleshub-dev-impersonate-user';
export type SessionUser = { id: number; name: string; email: string; role: UserRole; active: boolean; archivedAt?: Date | null };
type DevEnvironment = { NODE_ENV?: string; ENABLE_DEV_IMPERSONATION?: string };

export function devImpersonationEnabled(env: DevEnvironment = process.env) {
  return env.NODE_ENV !== 'production' && env.ENABLE_DEV_IMPERSONATION === 'true';
}

export function impersonationAdminAllowed(real: SessionUser | null | undefined, env: DevEnvironment = process.env) {
  return devImpersonationEnabled(env) && real?.role === 'ADMIN' && real.active && !real.archivedAt;
}

export function parseImpersonationId(raw: string | undefined): number | null {
  if (!raw || !/^[1-9]\d*$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) ? id : null;
}

export async function resolveUserContext(
  real: SessionUser | null | undefined,
  rawId: string | undefined,
  client: Pick<PrismaClient, 'user'>,
  env: DevEnvironment = process.env,
) {
  // A stale cookie has no effect unless the current Google-linked CRM user is Admin.
  if (!impersonationAdminAllowed(real, env) || !rawId) return { real: real ?? null, effective: real ?? null, impersonating: false, clearCookie: !!rawId };
  const id = parseImpersonationId(rawId);
  if (id === null) return { real: real!, effective: real!, impersonating: false, clearCookie: true };
  const target = await client.user.findUnique({ where: { id }, select: { id: true, firstName: true, lastName: true, email: true, role: true, active: true, archivedAt: true } });
  if (!target?.active || target.archivedAt) return { real: real!, effective: real!, impersonating: false, clearCookie: true };
  const effective: SessionUser = { id: target.id, name: `${target.firstName} ${target.lastName}`, email: target.email, role: target.role, active: target.active, archivedAt: target.archivedAt };
  return { real: real!, effective, impersonating: true, clearCookie: false };
}

export async function validateImpersonationTarget(client: Pick<PrismaClient, 'user'>, rawId: string) {
  const id = parseImpersonationId(rawId);
  if (id === null) throw new Error('Invalid user.');
  const target = await client.user.findUnique({ where: { id }, select: { id: true, active: true, archivedAt: true } });
  if (!target?.active || target.archivedAt) throw new Error('User is unavailable for impersonation.');
  return target.id;
}
