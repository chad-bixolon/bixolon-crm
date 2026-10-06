'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/current-user';
import { prisma } from '@/lib/prisma';
import { dismissAllReadNotifications, markAllNotificationsRead, updateNotification } from '@/lib/notifications';

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

export async function openNotification(form: FormData) {
  const actor = await currentUser();
  const id = Number(form.get('id'));
  const row = await prisma.notification.findFirst({ where: { id, userId: actor.id }, select: { actionUrl: true, entityType: true, entityId: true } });
  const prefix = row?.entityType === 'PRICE_EXCEPTION' ? '/price-exceptions' : row?.entityType === 'TASK' ? '/tasks' : row?.entityType === 'OPPORTUNITY' ? '/opportunities' : null;
  if (!row || !prefix || row.actionUrl !== `${prefix}/${row.entityId}`) redirect('/notifications');
  const allowed = await updateNotification(prisma, actor, id, 'read');
  if (!allowed) redirect('/notifications');
  revalidatePath('/notifications');
  revalidatePath('/', 'layout');
  redirect(row.actionUrl);
}
