'use server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getRealAuthenticatedUser } from '@/lib/current-user';
import { DEV_IMPERSONATION_COOKIE, impersonationAdminAllowed, validateImpersonationTarget } from '@/lib/dev-impersonation';
import { prisma } from '@/lib/prisma';

async function requireRealAdmin() {
  const real = await getRealAuthenticatedUser();
  if (!impersonationAdminAllowed(real)) throw new Error('Development impersonation is unavailable.');
}

export async function startImpersonation(form: FormData) {
  await requireRealAdmin();
  const id = await validateImpersonationTarget(prisma, String(form.get('userId') ?? ''));
  (await cookies()).set(DEV_IMPERSONATION_COOKIE, String(id), {
    httpOnly: true, sameSite: 'lax', secure: false, path: '/', maxAge: 60 * 60 * 8,
  });
  redirect('/');
}

export async function endImpersonation() {
  await requireRealAdmin();
  (await cookies()).delete(DEV_IMPERSONATION_COOKIE);
  redirect('/');
}
