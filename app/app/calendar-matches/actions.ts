'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { currentUser, getRealAuthenticatedUser } from '@/lib/current-user';
import { assertPermission, opportunityScope } from '@/lib/authorization';
import { assertProjectWorkEdit, projectReadWhere } from '@/lib/projects';
import { activityErrorField, activityFailureState, parseActivity, saveActivity } from '@/lib/work';
import type { WorkState } from '@/app/tasks/actions';
import { operationalAccountWhere, operationalContactWhere, operationalOpportunityWhere, operationalProjectWhere } from '@/lib/operational-where';
import { calendarLocalInput, calendarLocalToUtc } from '@/lib/calendar-time';
import { lockCalendarEvent } from '@/lib/calendar-event-lock';

async function ownedEvent(id: number) {
  const real = await getRealAuthenticatedUser();
  if (!real) throw new Error('Sign in to review Calendar events.');
  const event = await prisma.googleCalendarEvent.findFirst({ where: { id, userId: real.id, connection: { userId: real.id } }, include: { review: true } });
  if (!event) throw new Error('Calendar event not found.');
  return event;
}

export async function ignoreCalendarEvent(form: FormData) {
  const id = Number(form.get('eventId'));
  const event = await ownedEvent(id);
  const actor = await currentUser(); assertPermission(actor, 'tasks.write');
  if (event.review?.activityId) throw new Error('This meeting is already logged.');
  await prisma.$transaction(async tx => {
    await lockCalendarEvent(tx, id);
    const review = await tx.googleCalendarEventReview.findUnique({ where: { eventId: id } });
    if (review?.activityId) throw new Error('This meeting is already logged.');
    await tx.googleCalendarEventReview.upsert({ where: { eventId: id }, create: { eventId: id, ignoredAt: new Date(), ignoredById: actor.id, reviewedAt: new Date(), reviewedById: actor.id }, update: { ignoredAt: new Date(), ignoredById: actor.id, reviewedAt: new Date(), reviewedById: actor.id } });
  });
  revalidatePath('/calendar-matches'); redirect('/calendar-matches');
}

export async function saveCalendarSelection(form: FormData) {
  const id = Number(form.get('eventId'));
  const event = await ownedEvent(id);
  const actor = await currentUser(); assertPermission(actor, 'tasks.write');
  if (event.review?.activityId || event.review?.ignoredAt) throw new Error('This event is already reviewed.');
  const number = (name: string) => { const raw = String(form.get(name) ?? ''); const value = Number(raw); if (raw && (!Number.isSafeInteger(value) || value < 1)) throw new Error('Choose a valid record.'); return raw ? value : null; };
  const accountId = number('accountId'), opportunityId = number('opportunityId'), projectId = number('projectId');
  const contactIds = [...new Set(form.getAll('contactIds').map(Number))];
  if (contactIds.some(id => !Number.isSafeInteger(id) || id < 1)) throw new Error('Choose valid Contacts.');
  if (accountId && !await prisma.account.findFirst({ where: { id: accountId, AND: [operationalAccountWhere] } })) throw new Error('Choose an active Account.');
  if (contactIds.length) {
    const contacts = await prisma.contact.findMany({ where: { id: { in: contactIds }, AND: [operationalContactWhere] }, select: { id: true, accountId: true } });
    if (contacts.length !== contactIds.length || contacts.some(c => c.accountId && c.accountId !== accountId)) throw new Error('Choose Contacts at the selected Account.');
  }
  if (opportunityId && (!accountId || !await prisma.opportunity.findFirst({ where: { id: opportunityId, AND: [operationalOpportunityWhere], participants: { some: { accountId } }, ...opportunityScope(actor) } }))) throw new Error('Choose an Opportunity at this Account.');
  if (projectId && (!accountId || !await prisma.project.findFirst({ where: { id: projectId, AND: [operationalProjectWhere, projectReadWhere(actor)], OR: [{ primaryAccountId: accountId }, { participants: { some: { accountId } } }] } }))) throw new Error('Choose a Project at this Account.');
  if (projectId && opportunityId && !await prisma.opportunityProject.findUnique({ where: { opportunityId_projectId: { opportunityId, projectId } } })) throw new Error('This Project is not linked to the selected Opportunity.');
  await assertProjectWorkEdit(prisma, actor, projectId);
  await prisma.$transaction(async tx => {
    await lockCalendarEvent(tx, id);
    const latest = await tx.googleCalendarEventReview.findUnique({ where: { eventId: id } });
    if (latest?.activityId || latest?.ignoredAt) throw new Error('This event is already reviewed.');
    await tx.googleCalendarEventReview.upsert({ where: { eventId: id }, create: { eventId: id, selectionsConfirmed: true, selectedContactIds: contactIds, selectedAccountId: accountId, selectedOpportunityId: opportunityId, selectedProjectId: projectId, reviewedAt: new Date(), reviewedById: actor.id }, update: { selectionsConfirmed: true, selectedContactIds: contactIds, selectedAccountId: accountId, selectedOpportunityId: opportunityId, selectedProjectId: projectId, reviewedAt: new Date(), reviewedById: actor.id } });
  });
  revalidatePath('/calendar-matches'); redirect(`/calendar-matches/${id}`);
}

export async function submitCalendarActivity(eventId: number, _old: WorkState, form: FormData): Promise<WorkState> {
  const eventForDate = await ownedEvent(eventId);
  const real = await getRealAuthenticatedUser();
  const zone = real ? await prisma.user.findUnique({ where: { id: real.id }, select: { timeZone: true } }) : null;
  const timeZone = zone?.timeZone ?? 'America/New_York';
  const local = String(form.get('activityDate') ?? '');
  const original = eventForDate.startAt && calendarLocalInput(eventForDate.startAt, timeZone) === local ? eventForDate.startAt : null;
  const instant = original ?? calendarLocalToUtc(local, timeZone);
  if (!instant) return activityFailureState(form, { activityDate: 'Choose a valid time in your timezone.' });
  const utcForm = new FormData(); for (const [key, value] of form.entries()) utcForm.append(key, value);
  utcForm.set('activityDate', instant.toISOString().slice(0, 16));
  const parsed = parseActivity(utcForm);
  if (!parsed.value) return activityFailureState(form, parsed.errors);
  if (!parsed.value.userId) return activityFailureState(form, { userId: 'Choose a responsible user.' });
  try {
    const event = await ownedEvent(eventId);
    const actor = await currentUser(); assertPermission(actor, 'tasks.write');
    if (event.review?.activityId || event.review?.ignoredAt || !event.review || (event.review.matchStatus !== 'MATCHED' && !event.review.selectionsConfirmed)) throw new Error('Review this Calendar match before logging.');
    await assertProjectWorkEdit(prisma, actor, parsed.value.projectId);
    await saveActivity(prisma, parsed.value, undefined, actor.id, eventId);
    revalidatePath('/calendar-matches'); revalidatePath('/');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Activity could not be saved.';
    const field = activityErrorField(message);
    return activityFailureState(form, field ? { [field]: message } : {}, field ? undefined : message);
  }
  redirect('/calendar-matches?status=logged');
}
