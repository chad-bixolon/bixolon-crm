import { AppearancePreference, type PrismaClient } from '@prisma/client';

export function isAppearancePreference(value: unknown): value is AppearancePreference {
  return value === AppearancePreference.SYSTEM || value === AppearancePreference.LIGHT || value === AppearancePreference.DARK;
}

// The target is always the real authenticated user; no target ID is accepted.
export async function saveOwnAppearance(client: Pick<PrismaClient, 'user'>, real: { id: number; active: boolean; archivedAt?: Date | null } | null, value: unknown) {
  if (!real?.active || real.archivedAt) throw new Error('Sign in to update your appearance.');
  if (!isAppearancePreference(value)) throw new Error('Choose System, Light, or Dark.');
  const result = await client.user.updateMany({ where: { id: real.id, active: true, archivedAt: null }, data: { appearancePreference: value } });
  if (result.count !== 1) throw new Error('Your account is unavailable.');
  return value;
}
