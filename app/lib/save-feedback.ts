export type SaveOutcome = 'created' | 'updated' | 'activity-created' | 'activity-task-created';

export function saveFeedbackPath(path: string, outcome: SaveOutcome) {
  const hashIndex = path.indexOf('#');
  const hash = hashIndex >= 0 ? path.slice(hashIndex) : '';
  const pathAndQuery = hashIndex >= 0 ? path.slice(0, hashIndex) : path;
  const separator = pathAndQuery.includes('?') ? '&' : '?';
  return `${pathAndQuery}${separator}saved=${outcome}${hash}`;
}

export function saveFeedbackMessage(outcome: string | undefined, recordName: string) {
  if (outcome === 'activity-created') return 'Activity created.';
  if (outcome === 'activity-task-created') return 'Activity created and follow-up task scheduled.';
  if (outcome === 'created') return `${recordName} created successfully.`;
  if (outcome === 'updated') return 'Changes saved.';
  return null;
}
