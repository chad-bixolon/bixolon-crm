import { NAV_CATEGORIES } from '../../../../lib/navigation-categories';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { randomUUID } from 'crypto';
import { Content, PageHeader } from '@/components/shell';
import { WorkForm } from '@/components/work-form';
import { prisma } from '@/lib/prisma';
import { currentUser, getRealAuthenticatedUser } from '@/lib/current-user';
import { can } from '@/lib/authorization';
import { workOptions } from '@/lib/work-options';
import { defaultEligibleUserId } from '@/lib/assignment-eligibility';
import { submitCalendarActivity } from '../../actions';
import { calendarLocalInput } from '@/lib/calendar-time';

export const dynamic = 'force-dynamic';
export default async function LogCalendarMeeting({ params }: { params: Promise<{ id: string }> }) {
  const real = await getRealAuthenticatedUser(); if (!real) redirect('/sign-in');
  const actor = await currentUser(); if (!can(actor, 'tasks.write')) redirect('/access-denied');
  const id = Number((await params).id); if (!Number.isSafeInteger(id) || id < 1) notFound();
  const event = await prisma.googleCalendarEvent.findFirst({ where: { id, userId: real.id, connection: { userId: real.id } }, include: { review: true } }); if (!event) notFound();
  if (event.review?.activityId) redirect(`/activities/${event.review.activityId}/edit`);
  const meetingEnd = event.endAt ?? (event.endDate ? new Date(`${event.endDate}T00:00:00Z`) : null);
  if (!event.review || event.review.ignoredAt || (event.review.matchStatus !== 'MATCHED' && !event.review.selectionsConfirmed) || event.status === 'CANCELLED' || event.cancelledAt || !meetingEnd || meetingEnd > new Date()) redirect(`/calendar-matches/${id}`);
  const review = event.review; const selected = !!review?.selectionsConfirmed;
  const accountId = selected ? review!.selectedAccountId : review?.suggestedAccountId;
  const contactIds = selected ? review!.selectedContactIds : review?.suggestedContactIds ?? [];
  const opportunityId = selected ? review!.selectedOpportunityId : review?.suggestedOpportunityId;
  const projectId = selected ? review!.selectedProjectId : review?.suggestedProjectId;
  const options = await workOptions({ accountId, opportunityId, projectId, contactIds });
  const zone = await prisma.user.findUnique({ where: { id: real.id }, select: { timeZone: true } });
  const timeZone = zone?.timeZone ?? 'America/New_York';
  const meetingType = options.activityTypes.find(type => type.code === 'MEETING') ?? options.activityTypes.find(type => /^meeting$/i.test(type.name));
  return <Content><PageHeader eyebrow={NAV_CATEGORIES.sales} title="Log as Activity" description="Review the meeting details and save the Activity." action={<Link className="btn-secondary" href={`/calendar-matches/${id}`}>Back to match</Link>}/>
    {!meetingType && <p className="mb-4 rounded bg-amber-50 p-4 text-sm text-amber-900">No active Meeting Activity type is configured. Choose an appropriate type before saving.</p>}
    {!accountId && <p className="mb-4 rounded bg-amber-50 p-4 text-sm text-amber-900">Choose an Account before saving this Activity.</p>}
    <WorkForm kind="activity" calendarAction={submitCalendarActivity.bind(null, id)} calendarTimeZone={timeZone} createKey={randomUUID()} {...options} linkedContactIds={contactIds} initial={{ subject: event.summary || 'Meeting', accountId: accountId ?? '', opportunityId: opportunityId ?? '', projectId: projectId ?? '', userId: defaultEligibleUserId(options.users, actor.id), type: meetingType?.code ?? '', activityDate: event.startAt ? calendarLocalInput(event.startAt, timeZone) : event.startDate ? `${event.startDate}T12:00` : '', direction: 'NA' }}/>
  </Content>;
}
