import type { DemoPlanGroup } from './demo-import';

const dateFormatter = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

export function demoPreviewDate(timestamp: string | null): string {
  if (!timestamp) return '—';
  const date = new Date(timestamp);
  return Number.isNaN(date.valueOf()) ? '—' : dateFormatter.format(date);
}

export function demoPreviewItemSummary(group: DemoPlanGroup): string {
  const lines = group.items.length;
  const units = group.items.reduce((total, item) => total + item.quantity, 0);
  return `${lines} line${lines === 1 ? '' : 's'} · ${units} unit${units === 1 ? '' : 's'}`;
}

export function demoPreviewShipping(group: DemoPlanGroup): string {
  if (!group.shippedAt) return 'Not shipped';
  const tracking = [...new Set(group.items.flatMap(item => item.trackingNumbers))];
  return [demoPreviewDate(group.shippedAt), group.header['Shipping Carrier'].trim(), tracking.length ? `Tracking: ${tracking.join('; ')}` : ''].filter(Boolean).join(' · ');
}

export function demoPreviewIssue(issue: string, group: DemoPlanGroup): string {
  if (issue === 'VAR differs across source rows.') return 'Customer differs across source rows.';
  if (issue !== `VAR: ${group.account.issue}`) return issue;
  if (group.account.issue === 'No CRM match.') return 'Account match: Not found';
  if (group.account.issue === 'Multiple CRM matches.') return 'Account match: Multiple matches';
  return 'Account match: Source Account name missing';
}

export const demoPreviewFieldLabel = (field: string): string => field === 'VAR' ? 'Customer' : field;
