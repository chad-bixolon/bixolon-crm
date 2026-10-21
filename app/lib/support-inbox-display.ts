import type { suggestSupportEmails } from './support-email';
import type { SupportMailMessage } from './support-gmail';

type Suggestion = Awaited<ReturnType<typeof suggestSupportEmails>>[number]['suggestion'];

// Display only: suggestions and server-side validation remain the source of truth.
export function inboxMatchSummary(suggestion: Suggestion) {
  const needsReview = suggestion.threadConflict || suggestion.caseReferenceConflict || suggestion.multipleCaseReferences || suggestion.ambiguousContact || suggestion.relatedCaseCount > 1;
  const confidentCase = needsReview ? undefined : suggestion.suggestedCases.find(row => row.id === (suggestion.linkedThreadCaseId || suggestion.numberedCaseId)) ?? (suggestion.relatedCaseCount === 1 ? suggestion.suggestedCases[0] : undefined);
  const relationships = [suggestion.account?.name, suggestion.contact ? `${suggestion.contact.firstName} ${suggestion.contact.lastName}`.trim() : null, confidentCase ? `Case ${confidentCase.caseNumber}` : null].filter(Boolean);
  return {
    summary: relationships.length ? `Matched: ${relationships.join(' · ')}` : 'No confident CRM match',
    confidence: needsReview ? 'Needs review' : suggestion.linkedThreadCaseId || suggestion.numberedCaseId ? 'Strong match' : relationships.length ? 'Suggested' : null,
    needsReview,
  };
}

export function inboxAttachmentLabel(message: Pick<SupportMailMessage, 'files' | 'hasAttachments'>) {
  // Use metadata already fetched for intake; decorative inline assets stay out of the count.
  const count = message.files?.filter(file => !file.hiddenReason).length ?? 0;
  if (count) return `${count} attachment${count === 1 ? '' : 's'}`;
  return message.hasAttachments ? 'Attachments' : null;
}

export type InboxTriageState = { unlinked: boolean; needsReview: boolean };
export type InboxTriageView = 'all' | 'unlinked' | 'needs-review';
export const inboxTriageViews = [
  { id: 'all', label: 'All' },
  { id: 'unlinked', label: 'Unlinked' },
  { id: 'needs-review', label: 'Needs Review' },
] as const;

export function inboxTriageState(suggestion: Suggestion): InboxTriageState {
  const unlinked = !suggestion.alreadyLinkedCaseId;
  return { unlinked, needsReview: unlinked && inboxMatchSummary(suggestion).needsReview };
}

export function inboxMatchesView(row: InboxTriageState, view: InboxTriageView) {
  return view === 'all' || (view === 'unlinked' ? row.unlinked : row.needsReview);
}

export function inboxTriageCounts(rows: readonly InboxTriageState[]) {
  return { all: rows.length, unlinked: rows.filter(row => row.unlinked).length, 'needs-review': rows.filter(row => row.needsReview).length };
}

export function inboxScopeWording(shown: number, limit: number, lookbackDays: number) {
  return `${shown} message${shown === 1 ? '' : 's'} shown · Up to ${limit} messages from the last ${lookbackDays} day${lookbackDays === 1 ? '' : 's'}`;
}
