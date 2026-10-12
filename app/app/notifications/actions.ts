'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/current-user';
import { prisma } from '@/lib/prisma';
import { dismissAllReadNotifications, markAllNotificationsRead, snoozeUntil, snoozeUserNotification, updateNotification } from '@/lib/notifications';
import { preferenceCategories } from '@/lib/notification-preferences';

export async function markNotificationRead(form: FormData) {
  const actor = await currentUser();
  await updateNotification(prisma, actor, Number(form.get('id')), 'read');
  revalidatePath('/notifications');
  revalidatePath('/', 'layout');
}

export async function dismissNotification(form: FormData) {
  const actor = await currentUser();
  await updateNotification(prisma, actor, Number(form.get('id')), 'dismiss');
  revalidatePath('/notifications');
  revalidatePath('/', 'layout');
}

export async function markAllRead() {
  const actor = await currentUser();
  await markAllNotificationsRead(prisma, actor);
  revalidatePath('/notifications');
  revalidatePath('/', 'layout');
}

export async function dismissAllRead() {
  const actor = await currentUser();
  await dismissAllReadNotifications(prisma, actor);
  revalidatePath('/notifications');
  revalidatePath('/', 'layout');
}

export async function saveNotificationPreferences(_previous: { status: string }, form: FormData): Promise<{ status: string }> {
  const actor = await currentUser();
  try {
    await prisma.$transaction(preferenceCategories.map(category => {
      const enabled = form.get(category) === 'on';
      return prisma.notificationPreference.upsert({ where: { userId_category: { userId: actor.id, category } }, create: { userId: actor.id, category, enabled }, update: { enabled } });
    }));
  } catch {
    return { status: 'error' };
  }
  revalidatePath('/notifications/preferences');
  revalidatePath('/notifications');
  revalidatePath('/', 'layout');
  return { status: 'success' };
}

export async function snoozeNotification(form: FormData) {
  const actor = await currentUser();
  const user = await prisma.user.findUnique({ where: { id: actor.id }, select: { timeZone: true } });
  const until = snoozeUntil(String(form.get('choice') ?? ''), new Date(), user?.timeZone ?? 'America/New_York', String(form.get('custom') ?? ''));
  if (!until) throw new Error('Choose a future snooze time.');
  await snoozeUserNotification(prisma, actor, Number(form.get('id')), until);
  revalidatePath('/notifications');
  revalidatePath('/', 'layout');
}

export async function openNotification(form: FormData) {
  const actor = await currentUser();
  const id = Number(form.get('id'));
  const row = await prisma.notification.findFirst({ where: { id, userId: actor.id }, select: { actionUrl: true, entityType: true, entityId: true } });
  const prefix = row?.entityType === 'PRICE_EXCEPTION' ? '/price-exceptions' : row?.entityType === 'TASK' ? '/tasks' : row?.entityType === 'OPPORTUNITY' ? '/opportunities' : row?.entityType === 'SUPPORT_CASE' ? '/support/cases' : null;
  if (!row || !prefix || row.actionUrl !== `${prefix}/${row.entityId}`) redirect('/notifications');
  const allowed = await updateNotification(prisma, actor, id, 'read');
  if (!allowed) redirect('/notifications');
  revalidatePath('/notifications');
  revalidatePath('/', 'layout');
  redirect(row.actionUrl);
}
