import { Prisma, type PrismaClient } from '@prisma/client';
import { assertPermission, type Actor } from './authorization';

export function normalizeTrustedDomain(raw: string) {
  const domain = raw.trim().toLowerCase();
  if (domain.length > 253 || domain.length < 4 || !domain.includes('.') || !/[a-z]/.test(domain.split('.').at(-1) ?? '') ||
      domain.split('.').some(label => !label || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)) ||
      /[\s/:*\\@]/.test(domain)) throw new Error('Enter a domain such as example.com, without a protocol, path, or wildcard.');
  return domain;
}

export async function getTrustedDomains(client: Pick<PrismaClient, 'trustedSignInDomain'>, bootstrap = process.env.GOOGLE_WORKSPACE_DOMAIN) {
  const rows = await client.trustedSignInDomain.findMany({ orderBy: { domain: 'asc' } });
  if (rows.length) return rows;
  if (!bootstrap?.trim()) return [];
  try { return [{ domain: normalizeTrustedDomain(bootstrap), active: true, createdAt: new Date(0), updatedAt: new Date(0) }]; }
  catch { return []; }
}

export function emailDomain(email: string) {
  const parts = email.trim().toLowerCase().split('@');
  return parts.length === 2 ? parts[1] : '';
}

export function trustedGoogleDomain(hostedDomain: string | undefined, email: string | undefined, activeDomains: readonly string[]) {
  const hosted = hostedDomain?.toLowerCase() ?? '';
  return !!hosted && activeDomains.includes(hosted) && activeDomains.includes(emailDomain(email ?? ''));
}

export async function activeTrustedDomains(client: Pick<PrismaClient, 'trustedSignInDomain'>, bootstrap = process.env.GOOGLE_WORKSPACE_DOMAIN) {
  return (await getTrustedDomains(client, bootstrap)).filter(row => row.active).map(row => row.domain);
}

export async function mutateTrustedDomain(client: PrismaClient, actor: Actor, input: { action: 'add' | 'activate' | 'deactivate'; domain: string; confirmOwnDomain?: boolean; currentIdentityDomain?: string; currentIdentityEmailDomain?: string }, bootstrap = process.env.GOOGLE_WORKSPACE_DOMAIN) {
  assertPermission(actor, 'deployment.manage');
  const domain = normalizeTrustedDomain(input.domain);
  return client.$transaction(async tx => {
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(72341023)`;
    const persistedActor = await tx.user.findUnique({ where: { id: actor.id } });
    assertPermission(persistedActor, 'deployment.manage');
    if (!await tx.trustedSignInDomain.count()) {
      if (!bootstrap) throw new Error('Configure GOOGLE_WORKSPACE_DOMAIN before managing sign-in domains.');
      const seed = normalizeTrustedDomain(bootstrap);
      await tx.trustedSignInDomain.create({ data: { domain: seed, active: true } });
    }
    const existing = await tx.trustedSignInDomain.findUnique({ where: { domain } });
    if (input.action === 'add') {
      if (existing) throw new Error('This domain is already listed. Activate it if needed.');
      await tx.trustedSignInDomain.create({ data: { domain, active: true } });
    } else {
      if (!existing) throw new Error('Trusted domain not found.');
      if (existing.active === (input.action === 'activate')) return;
      if (input.action === 'deactivate') {
        if ((domain === input.currentIdentityDomain || domain === input.currentIdentityEmailDomain) && !input.confirmOwnDomain) throw new Error('This is your current sign-in domain. Confirm that you may lose access before deactivating it.');
        if (await tx.trustedSignInDomain.count({ where: { active: true } }) <= 1) throw new Error('Keep at least one active trusted sign-in domain.');
      }
      await tx.trustedSignInDomain.update({ where: { domain }, data: { active: input.action === 'activate' } });
    }
    await tx.adminMaintenanceEvent.create({ data: { actorId: actor.id, entityType: 'Trusted domain', action: input.action === 'add' ? 'Added' : input.action === 'activate' ? 'Activated' : 'Deactivated', recordIds: [], recordCount: 1, oldValue: existing ? `${domain}: ${existing.active ? 'Active' : 'Inactive'}` : null, newValue: `${domain}: ${input.action === 'deactivate' ? 'Inactive' : 'Active'}` } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
