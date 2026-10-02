'use server';
import { signOut } from '@/auth';
import { cookies } from 'next/headers';
import { DEV_IMPERSONATION_COOKIE } from '@/lib/dev-impersonation';
export async function signOutAction() {
  (await cookies()).delete(DEV_IMPERSONATION_COOKIE);
  await signOut({ redirectTo: '/sign-in' });
}
