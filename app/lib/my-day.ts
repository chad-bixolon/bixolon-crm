import type { PrismaClient } from '@prisma/client';
import { calendarLocalInput, calendarLocalToUtc } from './calendar-time';
import { matchCalendarAttendees } from './calendar-matching';
import { operationalAccountWhere, operationalActivityWhere, operationalContactWhere, operationalOpportunityWhere, operationalProjectWhere, operationalTaskWhere } from './operational-where';
import { can, opportunityScope, type Actor } from './authorization';
import { projectReadWhere } from './projects';
import { DEFAULT_USER_TIME_ZONE, isUserTimeZone } from './user-time-zone';

export type MyDayEntry = { key: string; at: Date | null; kind: 'customer' | 'internal' | 'activity' | 'completedTask' | 'dueTask'; title: string; detail: string; href?: string };
type Interval = { start: number; end: number };
export function mergedMinutes(intervals: Interval[]) {
  const sorted = intervals.filter(i => i.end > i.start).sort((a, b) => a.start - b.start);
  let total = 0, start = 0, end = 0;
  for (const interval of sorted) {
    if (interval.start > end) { total += end - start; start = interval.start; end = interval.end; }
    else end = Math.max(end, interval.end);
  }
  return Math.round((total + end - start) / 60000);
}
export function myDayBounds(localDate: string, timeZone: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate) || !isUserTimeZone(timeZone)) throw new Error('Invalid My Day date or time zone.');
  const day = new Date(`${localDate}T00:00:00Z`);
  if (Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== localDate) throw new Error('Invalid My Day date.');
  const nextDate = new Date(day.getTime() + 86400000).toISOString().slice(0, 10);
  const start = calendarLocalToUtc(`${localDate}T00:00`, timeZone);
  const end = calendarLocalToUtc(`${nextDate}T00:00`, timeZone);
  if (!start || !end) throw new Error('Invalid My Day date.');
  return { start, end, nextDate };
}
export function myDayToday(now: Date, timeZone: string) { return calendarLocalInput(now, timeZone).slice(0, 10); }
export function durationLabel(minutes: number) { return minutes >= 60 ? `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ''}` : `${minutes}m`; }

// userId must be the real authenticated identity, never the effective impersonated actor.
export async function getMyDaySummary(client: PrismaClient, userId: number, localDate: string, timeZone: string, now = new Date(), actor?: Actor) {
  const zone = isUserTimeZone(timeZone) ? timeZone : DEFAULT_USER_TIME_ZONE;
  const { start, end } = myDayBounds(localDate, zone);
  // Task dueDate is an existing date-only CRM value encoded at UTC midnight.
  const dueStart = new Date(`${localDate}T00:00:00Z`);
  const dueEnd = new Date(dueStart.getTime() + 86400000);
  const [events, activities, completedTasks, dueTasks, overdueTaskCount] = await Promise.all([
    client.googleCalendarEvent.findMany({ where: { userId, connection: { userId }, status: { not: 'CANCELLED' }, cancelledAt: null, OR: [{ allDay: false, startAt: { lt: end }, endAt: { gt: start } }, { allDay: true, startDate: { lt: dueEnd.toISOString().slice(0, 10) }, endDate: { gt: localDate } }] }, select: { id: true, summary: true, startAt: true, endAt: true, allDay: true, startDate: true, endDate: true, organizerEmail: true, attendees: { select: { email: true, displayName: true, self: true } }, connection: { select: { googleEmail: true } }, review: { select: { matchStatus: true, activityId: true, ignoredAt: true, selectionsConfirmed: true, selectedAccountId: true, suggestedAccountId: true, selectedContactIds: true, suggestedContactIds: true, selectedOpportunityId: true, suggestedOpportunityId: true, selectedProjectId: true, suggestedProjectId: true } } }, orderBy: { startAt: 'asc' }, take: 1000 }),
    client.activity.findMany({ where: { AND: [operationalActivityWhere], userId, activityDate: { gte: start, lt: end } }, select: { id: true, subject: true, activityDate: true, calendarReview: { select: { eventId: true } } }, orderBy: { activityDate: 'asc' }, take: 1000 }),
    client.task.findMany({ where: { AND: [operationalTaskWhere], assignedToId: userId, status: 'COMPLETED', completedAt: { gte: start, lt: end } }, select: { id: true, subject: true, completedAt: true }, orderBy: { completedAt: 'asc' }, take: 1000 }),
    client.task.findMany({ where: { AND: [operationalTaskWhere], assignedToId: userId, status: { in: ['OPEN', 'IN_PROGRESS'] }, dueDate: { gte: dueStart, lt: dueEnd } }, select: { id: true, subject: true, dueDate: true }, orderBy: { dueDate: 'asc' }, take: 1000 }),
    client.task.count({ where: { AND: [operationalTaskWhere], assignedToId: userId, status: { in: ['OPEN', 'IN_PROGRESS'] }, dueDate: { lt: dueStart } } }),
  ]);
  const contextRows = actor ? events.map(event => {
    const review = event.review;
    return review?.selectionsConfirmed ? { eventId: event.id, accountId: review.selectedAccountId, contactIds: review.selectedContactIds, opportunityId: review.selectedOpportunityId, projectId: review.selectedProjectId }
      : review?.matchStatus === 'MATCHED' ? { eventId: event.id, accountId: review.suggestedAccountId, contactIds: review.suggestedContactIds, opportunityId: review.suggestedOpportunityId, projectId: review.suggestedProjectId } : null;
  }).filter((row): row is NonNullable<typeof row> => !!row) : [];
  const ids = (values: (number | null | undefined)[]) => [...new Set(values.filter((id): id is number => !!id))];
  const [accounts, contacts, opportunities, projects] = actor && contextRows.length ? await Promise.all([
    can(actor, 'accounts.read') ? client.account.findMany({ where: { id: { in: ids(contextRows.map(row => row.accountId)) }, AND: [operationalAccountWhere] }, select: { id: true, name: true } }) : [],
    can(actor, 'contacts.read') ? client.contact.findMany({ where: { id: { in: ids(contextRows.flatMap(row => row.contactIds)) }, AND: [operationalContactWhere] }, select: { id: true, firstName: true, lastName: true } }) : [],
    can(actor, 'opportunities.read') ? client.opportunity.findMany({ where: { id: { in: ids(contextRows.map(row => row.opportunityId)) }, AND: [operationalOpportunityWhere], ...opportunityScope(actor) }, select: { id: true, name: true } }) : [],
    can(actor, 'projects.read') ? client.project.findMany({ where: { id: { in: ids(contextRows.map(row => row.projectId)) }, AND: [operationalProjectWhere, projectReadWhere(actor)] }, select: { id: true, name: true } }) : [],
  ]) : [[], [], [], []];
  const context = new Map(contextRows.map(row => [row.eventId, [
    accounts.find(item => item.id === row.accountId)?.name,
    ...row.contactIds.map(id => contacts.find(item => item.id === id)).filter((item): item is NonNullable<typeof item> => !!item).map(item => `${item.firstName} ${item.lastName}`),
    opportunities.find(item => item.id === row.opportunityId)?.name,
    projects.find(item => item.id === row.projectId)?.name,
  ].filter(Boolean).join(' · ')]));
  const timeline: MyDayEntry[] = [];
  const customer: Interval[] = [], internal: Interval[] = [];
  let customerMeetingCount = 0;
  const linkedActivityIds = new Set<number>();
  const domain = process.env.GOOGLE_WORKSPACE_DOMAIN?.trim().toLowerCase() ?? '';
  for (const event of events) {
    const attendeeMatch = matchCalendarAttendees(event.attendees, [], domain, event.connection.googleEmail, event.organizerEmail);
    const kind = attendeeMatch.external.length > 0 ? 'customer' : event.review?.matchStatus === 'INTERNAL' ? 'internal' : null;
    if (!kind) continue;
    if (event.review?.activityId) linkedActivityIds.add(event.review.activityId);
    const ended = event.allDay ? !!event.endDate && event.endDate <= myDayToday(now, zone) : !!event.endAt && event.endAt <= now;
    const timed = !event.allDay && !!event.startAt && !!event.endAt;
    if (kind === 'customer' && ended) customerMeetingCount++;
    if (ended && timed) {
      const clipped = { start: Math.max(event.startAt!.getTime(), start.getTime()), end: Math.min(event.endAt!.getTime(), end.getTime()) };
      if (clipped.end > clipped.start) (kind === 'customer' ? customer : internal).push(clipped);
    }
    const minutes = timed ? Math.round((event.endAt!.getTime() - event.startAt!.getTime()) / 60000) : 0;
    const logged = !!event.review?.activityId;
    const needsReview = kind === 'customer' && ended && !logged && !event.review?.ignoredAt && !event.review?.selectionsConfirmed;
    timeline.push({ key: `calendar-${event.id}`, at: event.startAt, kind, title: event.summary || (kind === 'customer' ? 'Customer meeting' : 'Internal meeting'), detail: `${event.allDay ? 'All day' : durationLabel(minutes)} · ${kind === 'customer' ? 'Customer meeting' : 'Internal'}${logged ? ' · Logged as Activity' : needsReview ? ' · Needs review' : ''}${context.get(event.id) ? ` · ${context.get(event.id)}` : ''}`, href: logged ? `/activities/${event.review!.activityId}/edit` : needsReview ? `/calendar-matches/${event.id}` : undefined });
  }
  for (const activity of activities) if (!linkedActivityIds.has(activity.id)) timeline.push({ key: `activity-${activity.id}`, at: activity.activityDate, kind: 'activity', title: activity.subject, detail: 'Activity logged', href: `/activities/${activity.id}/edit` });
  for (const task of completedTasks) timeline.push({ key: `completed-${task.id}`, at: task.completedAt, kind: 'completedTask', title: task.subject, detail: 'Task completed', href: `/tasks/${task.id}` });
  for (const task of dueTasks) timeline.push({ key: `due-${task.id}`, at: null, kind: 'dueTask', title: task.subject, detail: 'Task due today', href: `/tasks/${task.id}` });
  timeline.sort((a, b) => (a.at?.getTime() ?? Number.MAX_SAFE_INTEGER) - (b.at?.getTime() ?? Number.MAX_SAFE_INTEGER));
  // Customer wins a cross-category overlap. Both category totals remain additive to occupied time.
  const customerMeetingMinutes = mergedMinutes(customer);
  const totalMeetingMinutes = mergedMinutes([...customer, ...internal]);
  return { localDate, timeZone: zone, customerMeetingCount, customerMeetingMinutes, internalMeetingMinutes: totalMeetingMinutes - customerMeetingMinutes, totalMeetingMinutes, completedActivityCount: activities.length, completedTaskCount: completedTasks.length, dueTodayTaskCount: dueTasks.length, overdueTaskCount, timeline };
}
