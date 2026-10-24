import { Prisma, type PrismaClient } from '@prisma/client';
import { assertPermission, type Actor } from './authorization';
import { normalizeTrustedDomain } from './trusted-domains';

export type InternalDomainRow = { domain: string; active: boolean; createdAt: Date; updatedAt: Date; updatedById: number | null };
type DomainClient = Pick<PrismaClient, 'internalEmailDomain' | 'trustedSignInDomain'>;

export function normalizeInternalDomain(raw: string): string {
  return normalizeTrustedDomain(raw);
}

function validDomain(raw: string | undefined | null): string | null {
  if (!raw) return null;
  try { return normalizeInternalDomain(raw); } catch { return null; }
}

export async function getInternalDomainRows(client: DomainClient, bootstrap = process.env.GOOGLE_WORKSPACE_DOMAIN): Promise<{ rows: InternalDomainRow[]; persisted: boolean }> {
  const rows = await client.internalEmailDomain.findMany({ orderBy: { domain: 'asc' } });
  if (rows.length) return { rows, persisted: true };
  const trusted = await client.trustedSignInDomain.findMany({ where: { active: true }, select: { domain: true } });
  const domains = new Set([validDomain(bootstrap), ...trusted.map(row => validDomain(row.domain))].filter((domain): domain is string => !!domain));
  return { rows: [...domains].sort().map(domain => ({ domain, active: true, createdAt: new Date(0), updatedAt: new Date(0), updatedById: null })), persisted: false };
}

export async function activeInternalDomainSet(client: DomainClient, bootstrap = process.env.GOOGLE_WORKSPACE_DOMAIN): Promise<ReadonlySet<string>> {
  return new Set((await getInternalDomainRows(client, bootstrap)).rows.filter(row => row.active).map(row => row.domain));
}

export function isInternalEmail(email: string, domains: ReadonlySet<string>): boolean {
  const parts = email.trim().split('@');
  return parts.length === 2 && !!parts[0] && domains.has(parts[1].toLowerCase());
}

export async function mutateInternalDomain(client: PrismaClient, actor: Actor, input: { action: 'add' | 'activate' | 'deactivate'; domain: string }, bootstrap = process.env.GOOGLE_WORKSPACE_DOMAIN) {
  assertPermission(actor, 'deployment.manage');
  const domain = normalizeInternalDomain(input.domain);
  return client.$transaction(async tx => {
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(72341026)`;
    assertPermission(await tx.user.findUnique({ where: { id: actor.id } }), 'deployment.manage');
    const current = await getInternalDomainRows(tx as DomainClient, bootstrap);
    if (!current.persisted) for (const seed of current.rows) await tx.internalEmailDomain.create({ data: { domain: seed.domain, active: true } });
    const existing = current.rows.find(row => row.domain === domain);
    if (input.action === 'add') {
      if (existing) throw new Error('This domain is already listed. Activate it if needed.');
      await tx.internalEmailDomain.create({ data: { domain, active: true, updatedById: actor.id } });
    } else {
      if (!existing) throw new Error('Internal Email Domain not found.');
      if (existing.active === (input.action === 'activate')) return;
      await tx.internalEmailDomain.update({ where: { domain }, data: { active: input.action === 'activate', updatedById: actor.id } });
    }
    await tx.adminMaintenanceEvent.create({ data: {
      actorId: actor.id, entityType: 'Internal domain', action: input.action === 'add' ? 'Added' : input.action === 'activate' ? 'Activated' : 'Deactivated',
      recordIds: [], recordCount: 1,
      oldValue: existing ? `${domain}: ${existing.active ? 'Active' : 'Inactive'}` : null,
      newValue: `${domain}: ${input.action === 'deactivate' ? 'Inactive' : 'Active'}`,
    } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
