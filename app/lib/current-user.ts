import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { cookies } from 'next/headers';
import { prisma } from '@/lib/prisma';
import { DEV_IMPERSONATION_COOKIE, resolveUserContext } from './dev-impersonation';
import { can, type Actor, type Permission } from './authorization';

export async function userContext() {
  const session = await auth();
  const rawId = (await cookies()).get(DEV_IMPERSONATION_COOKIE)?.value;
  return { ...await resolveUserContext(session?.crmUser, rawId, prisma), hasSession: !!session };
}

export async function getRealAuthenticatedUser() {
  const session = await auth();
  return session?.crmUser ?? null;
}

export async function currentUser(): Promise<Actor & { name: string; email: string }> {
  const context = await userContext();
  if (!context.real) redirect(context.hasSession ? '/access-denied?reason=inactive' : '/sign-in');
  if (!context.effective) redirect('/access-denied?reason=inactive');
  return context.effective;
}
export async function requirePermission(permission: Permission) {
  const user = await currentUser();
  if (!can(user, permission)) redirect('/access-denied');
  return user;
}
export async function requireMutation(permission: Permission) {
  const user = await currentUser();
  if (!can(user, permission)) throw new Error('Access denied');
  return user;
}
