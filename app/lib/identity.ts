import type { PrismaClient, User } from '@prisma/client';

export const GOOGLE_ISSUER = 'https://accounts.google.com';
type GoogleProfile = { sub?: unknown; iss?: unknown; hd?: unknown; email?: unknown; email_verified?: unknown };
type IdentityResult = { user: User; identityId: number; reason?: never } | { reason: 'invalid' | 'workspace' | 'inactive' | 'unapproved'; user?: never; identityId?: never };

export async function resolveGoogleIdentity(
  client: Pick<PrismaClient, 'externalIdentity' | 'user'>,
  profile: GoogleProfile,
  workspaceDomain?: string,
): Promise<IdentityResult> {
  if (typeof profile.sub !== 'string' || !profile.sub ||
      typeof profile.email !== 'string' || !profile.email ||
      profile.email_verified !== true ||
      (profile.iss !== undefined && profile.iss !== GOOGLE_ISSUER && profile.iss !== 'accounts.google.com')) {
    return { reason: 'invalid' };
  }
  if (!workspaceDomain || typeof profile.hd !== 'string' || profile.hd.toLowerCase() !== workspaceDomain.toLowerCase()) {
    return { reason: 'workspace' };
  }

  const key = { issuer: GOOGLE_ISSUER, subject: profile.sub };
  const existing = await client.externalIdentity.findUnique({ where: { issuer_subject: key }, include: { user: true } });
  if (existing) return existing.provider === 'GOOGLE' && existing.user.active && !existing.user.archivedAt
    ? { user: existing.user, identityId: existing.id }
    : { reason: existing.provider === 'GOOGLE' ? 'inactive' : 'invalid' };

  // Email is used only once, to link a Google subject to a pre-created CRM user.
  // Subsequent sign-ins always follow issuer + subject, even if an email changes.
  const user = await client.user.findUnique({ where: { email: profile.email } });
  if (!user) return { reason: 'unapproved' };
  if (!user.active || user.archivedAt) return { reason: 'inactive' };
  try {
    const identity = await client.externalIdentity.create({ data: { provider: 'GOOGLE', ...key, userId: user.id } });
    return { user, identityId: identity.id };
  } catch (error) {
    // Unique issuer/subject or user/provider constraints settle concurrent first logins.
    // Never update an existing mapping or attach this subject to another CRM user.
    if (typeof error !== 'object' || error === null || !('code' in error) || error.code !== 'P2002') throw error;
    const winner = await client.externalIdentity.findUnique({ where: { issuer_subject: key }, include: { user: true } });
    if (winner?.provider === 'GOOGLE') return winner.user.active && !winner.user.archivedAt ? { user: winner.user, identityId: winner.id } : { reason: 'inactive' };
    return { reason: 'unapproved' };
  }
}

export async function resolveLinkedSession(client: Pick<PrismaClient, 'externalIdentity' | 'user'>, userId: number, identityId: number) {
  const identity = await client.externalIdentity.findUnique({ where: { id: identityId }, select: { userId: true, provider: true } });
  if (!identity || identity.provider !== 'GOOGLE' || identity.userId !== userId) return null;
  const user = await client.user.findUnique({ where: { id: userId } });
  return user?.active && !user.archivedAt ? user : null;
}

export async function unlinkGoogleIdentity(
  client: Pick<PrismaClient, 'externalIdentity' | 'user'>,
  userId: number,
  identityId: number,
  confirmationEmail: string,
) {
  const user = await client.user.findUnique({
    where: { id: userId },
    select: { email: true },
  });

  if (!user) {
    throw new Error('CRM user not found.');
  }

  if (user.email.toLowerCase() !== confirmationEmail.trim().toLowerCase()) {
    throw new Error('Enter the exact CRM email to reset the Google identity.');
  }

  const result = await client.externalIdentity.deleteMany({
    where: {
      id: identityId,
      userId,
      provider: 'GOOGLE',
    },
  });

  if (result.count !== 1) {
    throw new Error('Google identity link not found.');
  }
}
