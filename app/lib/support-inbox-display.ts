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
