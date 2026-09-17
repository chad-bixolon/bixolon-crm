import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { can, type Actor, type Permission } from './authorization';

export async function currentUser(): Promise<Actor & { name: string; email: string }> {
  const session = await auth();
  if (!session) redirect('/sign-in');
  if (!session.crmUser) redirect('/access-denied?reason=inactive');
  return session.crmUser;
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
