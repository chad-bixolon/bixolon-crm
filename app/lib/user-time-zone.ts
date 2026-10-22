import type { PrismaClient } from '@prisma/client';

export const DEFAULT_USER_TIME_ZONE = 'America/New_York';

export const USER_TIME_ZONE_OPTIONS = [
  { value: 'America/New_York', label: 'Eastern Time' },
  { value: 'America/Chicago', label: 'Central Time' },
  { value: 'America/Denver', label: 'Mountain Time' },
  { value: 'America/Phoenix', label: 'Arizona' },
  { value: 'America/Los_Angeles', label: 'Pacific Time' },
  { value: 'America/Anchorage', label: 'Alaska' },
  { value: 'Pacific/Honolulu', label: 'Hawaii' },
] as const;

export const IANA_TIME_ZONES = [...new Set(['UTC', 'Asia/Seoul', ...Intl.supportedValuesOf('timeZone'), ...USER_TIME_ZONE_OPTIONS.map(zone => zone.value)])].sort();

export function isUserTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 100 || !/^[A-Za-z_]+(?:\/[A-Za-z0-9_+.-]+)*$/.test(value)) return false;
  try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; }
}

// The caller supplies the real Auth.js identity. No target user ID is accepted from the form.
export async function saveOwnTimeZone(client: Pick<PrismaClient, 'user'>, real: { id: number; active: boolean; archivedAt?: Date | null } | null, value: unknown) {
  if (!real?.active || real.archivedAt) throw new Error('Sign in to update your time zone.');
  if (!isUserTimeZone(value)) throw new Error('Choose a supported time zone.');
  const result = await client.user.updateMany({ where: { id: real.id, active: true, archivedAt: null }, data: { timeZone: value } });
  if (result.count !== 1) throw new Error('Your account is unavailable.');
}

// Presentation only: preserve stored identifiers, including runtime-supported aliases.
export function userTimeZoneLabel(value: string): string {
  return USER_TIME_ZONE_OPTIONS.find(zone => zone.value === value)?.label
    ?? (value === 'UTC' ? 'UTC' : value.split('/').at(-1)!.replaceAll('_', ' '));
}

export function userTimeZoneOptions(selected = DEFAULT_USER_TIME_ZONE) {
  return [...new Set([...IANA_TIME_ZONES, ...(isUserTimeZone(selected) ? [selected] : [])])]
    .map(value => ({ value, label: value === 'UTC' ? 'UTC' : `${userTimeZoneLabel(value)} — ${value}` }))
    .sort((a, b) => a.label.localeCompare(b.label));
}
