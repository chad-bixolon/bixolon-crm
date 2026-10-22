import { roleLabels } from './role-labels';
import { userTimeZoneLabel } from './user-time-zone';

// Translate evidence at display time; never rewrite stored actions or old/new values.
export function userHistoryDescription(event: { action: string; oldValue: string | null; newValue: string | null }): string {
  const { action, oldValue, newValue } = event;
  if (action === 'Identity reset') return 'Google sign-in link reset';
  if (action === 'Delegation changed' && (newValue === 'true' || newValue === 'false')) {
    return `User Administration Access ${newValue === 'true' ? 'enabled' : 'disabled'}`;
  }
  const label = (value: string | null): string => {
    if (value === null) return 'Not set';
    if (action === 'Role changed') return roleLabels[value as keyof typeof roleLabels] ?? value;
    if (action === 'Status changed') return value === 'true' ? 'Active' : value === 'false' ? 'Inactive' : value;
    if (action === 'Timezone changed') return userTimeZoneLabel(value);
    return value;
  };
  return oldValue !== null || newValue !== null ? `${action} from ${label(oldValue)} to ${label(newValue)}` : action;
}
