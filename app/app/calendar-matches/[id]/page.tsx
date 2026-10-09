import { NAV_CATEGORIES } from '../../../lib/navigation-categories';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Content, PageHeader } from '@/components/shell';
import { prisma } from '@/lib/prisma';
import { currentUser, getRealAuthenticatedUser } from '@/lib/current-user';
import { can } from '@/lib/authorization';
import { evaluateCalendarEvent } from '@/lib/calendar-matching';
import { workOptions } from '@/lib/work-options';
import { formatDateTimeForUser } from '@/lib/display-format';
import { ignoreCalendarEvent } from '../actions';
import { CalendarMatchForm } from '@/components/calendar-match-form';

export const dynamic = 'force-dynamic';
export default async function ReviewCalendarMatch({ params }: { params: Promise<{ id: string }> }) {
  const real = await getRealAuthenticatedUser(); if (!real) redirect('/sign-in');
  const id = Number((await params).id); if (!Number.isSafeInteger(id) || id < 1) notFound();
  const actor = await currentUser();
  const event = await prisma.googleCalendarEvent.findFirst({ where: { id, userId: real.id, connection: { userId: real.id } }, include: { attendees: true, review: true, connection: { select: { googleEmail: true } } } }); if (!event) notFound();
  const match = await evaluateCalendarEvent(prisma, id, actor, event.connection.googleEmail);
  const review = await prisma.googleCalendarEventReview.findUniqueOrThrow({ where: { eventId: id } });
  const accountId = review.selectionsConfirmed ? review.selectedAccountId : review.suggestedAccountId;
  const contactIds = review.selectionsConfirmed ? review.selectedContactIds : review.suggestedContactIds;
  const opportunityId = review.selectionsConfirmed ? review.selectedOpportunityId : review.suggestedOpportunityId;
  const projectId = review.selectionsConfirmed ? review.selectedProjectId : review.suggestedProjectId;
  const options = await workOptions({ accountId, opportunityId, projectId, contactIds }); const zone = await prisma.user.findUnique({ where: { id: real.id }, select: { timeZone: true } });
  const complete = (event.endAt ?? (event.endDate ? new Date(`${event.endDate}T00:00:00Z`) : null))! <= new Date();
  const loggable = complete && !event.cancelledAt && event.status !== 'CANCELLED' && !review.activityId && !review.ignoredAt && !!accountId && (review.matchStatus === "MATCHED" || review.selectionsConfirmed) && can(actor, 'tasks.write');
  return <Content><PageHeader title={event.summary || 'Calendar event'} eyebrow={NAV_CATEGORIES.sales} description={event.allDay ? `${event.startDate} · All day` : event.startAt ? formatDateTimeForUser(event.startAt, zone?.timeZone ?? 'America/New_York') : 'Time unavailable'} action={<Link className="btn-secondary" href="/calendar-matches">Back to queue</Link>}/>
    <section className="panel mb-5 space-y-2 p-5"><h2 className="font-semibold">Match explanation</h2>{match.explanations.length ? match.explanations.map((reason, index) => <p className="text-sm" key={index}>{reason}</p>) : <p className="text-sm">No external customer attendees found.</p>}<p className="text-sm font-semibold">{review.activityId ? 'Logged' : review.ignoredAt ? 'Ignored' : event.cancelledAt ? 'Cancelled' : match.status}</p></section>
    {review.activityId ? <Link className="btn-primary" href={`/activities/${review.activityId}/edit`}>View logged Activity</Link> : review.ignoredAt ? <p className="panel p-5">This meeting was ignored.</p> : can(actor, 'tasks.write') ? <>
      <CalendarMatchForm eventId={id} options={options} initial={{ accountId, contactIds, opportunityId, projectId }}/>
      {loggable && <Link className="btn-secondary mt-4" href={`/calendar-matches/${id}/log`}>Log as Activity</Link>}<form className="mt-4" action={ignoreCalendarEvent}><input type="hidden" name="eventId" value={id}/><button className="btn-secondary">Ignore meeting</button></form>
    </> : <p className="panel p-5">You can view this match, but your role cannot log Activities.</p>}
  </Content>;
}
