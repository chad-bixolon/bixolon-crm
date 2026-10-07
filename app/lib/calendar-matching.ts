import type { GoogleCalendarAttendee, PrismaClient } from '@prisma/client';
import type { Actor } from './authorization';
import { opportunityScope } from './authorization';
import { operationalAccountWhere, operationalContactWhere, operationalOpportunityWhere, operationalProjectWhere } from './operational-where';
import { projectReadWhere } from './projects';

export const normalizeCalendarEmail = (email: string) => email.trim().toLowerCase();
export type CalendarContact = { id: number; firstName: string; lastName: string; email: string | null; accountId: number | null };
export type CalendarMatch = {
  status: 'MATCHED' | 'SUGGESTED' | 'UNMATCHED' | 'INTERNAL'; contactIds: number[]; accountId: number | null;
  opportunityId: number | null; projectId: number | null; explanations: string[];
};

export function matchCalendarAttendees(attendees: Pick<GoogleCalendarAttendee, 'email' | 'displayName' | 'self'>[], contacts: CalendarContact[], internalDomain: string, ownerEmail: string, organizerEmail?: string | null) {
  const normalizedOwner = normalizeCalendarEmail(ownerEmail);
  const domain = internalDomain.trim().toLowerCase();
  const isInternal = (email: string) => email === normalizedOwner || (!!domain && email.endsWith(`@${domain}`));
  // An empty or incomplete attendee list cannot prove that a meeting is internal.
  // The organizer can disqualify an internal classification, even when absent
  // from the attendee list.
  const organizer = normalizeCalendarEmail(organizerEmail ?? '');
  const internalOnly = attendees.length > 0 && attendees.every(a => {
    const email = normalizeCalendarEmail(a.email);
    return !!email && (a.self || isInternal(email));
  }) && (!organizer || isInternal(organizer));
  const external = attendees.filter(a => {
    const email = normalizeCalendarEmail(a.email);
    return email && !a.self && !isInternal(email);
  });
  const matched: CalendarContact[] = [], explanations: string[] = [];
  let ambiguous = false;
  for (const attendee of external) {
    const email = normalizeCalendarEmail(attendee.email);
    const candidates = contacts.filter(c => c.email && normalizeCalendarEmail(c.email) === email);
    if (candidates.length === 1) {
      matched.push(candidates[0]);
      explanations.push(`Matched ${candidates[0].firstName} ${candidates[0].lastName} by email ${attendee.email}`);
    } else if (candidates.length > 1) {
      ambiguous = true;
      explanations.push(`Multiple SalesHub Contacts use ${attendee.email} — select one`);
    } else explanations.push(`No SalesHub Contact found for ${attendee.email}`);
  }
  const accountIds = [...new Set(matched.map(c => c.accountId).filter((id): id is number => id !== null))];
  if (accountIds.length > 1) { ambiguous = true; explanations.push('Matched Contacts belong to multiple Accounts — select one'); }
  if (matched.some(c => c.accountId === null)) explanations.push('A matched Contact has no Account');
  return { internalOnly, external, matched, contactIds: [...new Set(matched.map(c => c.id))], accountId: accountIds.length === 1 ? accountIds[0] : null, ambiguous, explanations };
}

export function classifyCalendarMatch(contactCount: number, accountId: number | null, ambiguous: boolean, opportunityCount: number, projectCount: number): CalendarMatch['status'] {
  if (!contactCount) return 'UNMATCHED';
  return !accountId || ambiguous || opportunityCount > 1 || projectCount > 1 ? 'SUGGESTED' : 'MATCHED';
}

export async function evaluateCalendarEvent(client: PrismaClient, eventId: number, actor: Actor, ownerEmail: string): Promise<CalendarMatch> {
  const event = await client.googleCalendarEvent.findUniqueOrThrow({ where: { id: eventId }, include: { attendees: true, review: true } });
  const domain = process.env.GOOGLE_WORKSPACE_DOMAIN?.trim().toLowerCase() ?? '';
  const emails = [...new Set(event.attendees.map(a => normalizeCalendarEmail(a.email)).filter(Boolean))];
  const contacts = emails.length ? await client.contact.findMany({ where: { AND: [operationalContactWhere], OR: emails.map(email => ({ email: { equals: email, mode: 'insensitive' as const } })) }, select: { id: true, firstName: true, lastName: true, email: true, accountId: true } }) : [];
  const result = matchCalendarAttendees(event.attendees, contacts, domain, ownerEmail, event.organizerEmail);
  if (result.internalOnly && !event.review?.selectionsConfirmed && !event.review?.activityId) {
    const match: CalendarMatch = { status: 'INTERNAL', contactIds: [], accountId: null, opportunityId: null, projectId: null, explanations: [] };
    await client.googleCalendarEventReview.upsert({ where: { eventId }, create: { eventId, matchStatus: match.status, explanations: [], suggestedContactIds: [], suggestedAccountId: null, suggestedOpportunityId: null, suggestedProjectId: null }, update: { matchStatus: match.status, explanations: [], suggestedContactIds: [], suggestedAccountId: null, suggestedOpportunityId: null, suggestedProjectId: null } });
    return match;
  }
  if (result.internalOnly && (event.review?.selectionsConfirmed || event.review?.activityId)) {
    const review = event.review;
    return { status: review.matchStatus as CalendarMatch['status'], contactIds: review.suggestedContactIds, accountId: review.suggestedAccountId, opportunityId: review.suggestedOpportunityId, projectId: review.suggestedProjectId, explanations: review.explanations };
  }
  let accountId = result.accountId;
  if (accountId && !await client.account.findFirst({ where: { id: accountId, AND: [operationalAccountWhere] }, select: { id: true } })) accountId = null;
  const opportunities = accountId ? await client.opportunity.findMany({ where: { AND: [operationalOpportunityWhere], stage: { isClosed: false }, participants: { some: { accountId } }, ...opportunityScope(actor) }, select: { id: true }, take: 2 }) : [];
  const projects = accountId ? await client.project.findMany({ where: { AND: [operationalProjectWhere, projectReadWhere(actor)], status: { in: ['PLANNING', 'ACTIVE'] }, OR: [{ primaryAccountId: accountId }, { participants: { some: { accountId } } }], ...(opportunities.length === 1 ? { opportunities: { some: { opportunityId: opportunities[0].id } } } : {}) }, select: { id: true }, take: 2 }) : [];
  const explanations = [...result.explanations];
  if (opportunities.length > 1) explanations.push('Multiple open Opportunities found — select one');
  if (projects.length > 1) explanations.push('Multiple active Projects found — select one');
  const match: CalendarMatch = { status: classifyCalendarMatch(result.contactIds.length, accountId, result.ambiguous, opportunities.length, projects.length), contactIds: result.contactIds, accountId, opportunityId: opportunities.length === 1 ? opportunities[0].id : null, projectId: projects.length === 1 ? projects[0].id : null, explanations };
  await client.googleCalendarEventReview.upsert({ where: { eventId }, create: { eventId, matchStatus: match.status, explanations: match.explanations, suggestedContactIds: match.contactIds, suggestedAccountId: match.accountId, suggestedOpportunityId: match.opportunityId, suggestedProjectId: match.projectId }, update: { matchStatus: match.status, explanations: match.explanations, suggestedContactIds: match.contactIds, suggestedAccountId: match.accountId, suggestedOpportunityId: match.opportunityId, suggestedProjectId: match.projectId } });
  return match;
}
