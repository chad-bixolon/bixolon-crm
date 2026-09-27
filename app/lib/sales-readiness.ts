import type { PrismaClient } from '@prisma/client';
import type { AccountFields } from './account-validation';
import type { OpportunityInput } from './opportunities';
import { createHash } from 'node:crypto';

export type DuplicateMatch = { id: number; name: string; reason: string; exact?: boolean; archived?: boolean };
export function reviewFingerprint(value: unknown) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
const normalize = (value: string) => value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
const company = (value: string) => normalize(value).replace(/\b(incorporated|inc|llc|ltd|limited|corp|corporation|company|co)\b/g, '').trim().replace(/\s+/g, ' ');
const domain = (website: string | null) => { try { return website ? new URL(website).hostname.toLowerCase().replace(/^www\./, '') : ''; } catch { return ''; } };
type AccountCandidate = { id: number; name: string; website: string | null; addressLine1: string | null; postalCode: string | null; archivedAt: Date | null };
export function accountDuplicateMatches(input: Pick<AccountFields, 'name'|'website'|'addressLine1'|'postalCode'>, candidates: AccountCandidate[]): DuplicateMatch[] {
  const key = normalize(input.name), stem = company(input.name), host = domain(input.website);
  return candidates.flatMap(candidate => {
    const sameName = key === normalize(candidate.name);
    const sameDomain = !!host && host === domain(candidate.website);
    const sameAddress = !!input.addressLine1 && !!input.postalCode && normalize(input.addressLine1) === normalize(candidate.addressLine1 ?? '') && normalize(input.postalCode) === normalize(candidate.postalCode ?? '');
    const similarName = !!stem && stem.length >= 4 && (stem === company(candidate.name) || (stem.length >= 7 && company(candidate.name).length >= 7 && (stem.includes(company(candidate.name)) || company(candidate.name).includes(stem))));
    if (!sameName && !sameDomain && !sameAddress && !similarName) return [];
    return [{ id: candidate.id, name: candidate.name, reason: sameName ? 'Same normalized name' : sameDomain ? 'Same website domain' : sameAddress ? 'Same street address and postal code' : 'Similar company name', exact: sameName, archived: !!candidate.archivedAt }];
  }).sort((a,b) => Number(!!b.exact) - Number(!!a.exact)).slice(0, 10);
}
export async function findAccountDuplicates(client: Pick<PrismaClient, 'account'>, input: AccountFields) {
  const candidates = await client.account.findMany({ select: { id: true, name: true, website: true, addressLine1: true, postalCode: true, archivedAt: true } });
  return accountDuplicateMatches(input, candidates);
}
export async function accountSaveReview(client: Pick<PrismaClient, 'account'>, input: AccountFields, form: FormData) {
  const matches = await findAccountDuplicates(client, input);
  const reviewToken = reviewFingerprint(input);
  return matches.length && form.get('reviewedDuplicates') !== reviewToken ? { matches, values: input, reviewToken } : null;
}

type OpportunityCandidate = { id: number; name: string; ownerId: number | null; expectedCloseDate: Date | null; participants: { accountId: number }[]; projects: { projectId: number }[] };
const quarter = (date: Date | null) => date ? `${date.getUTCFullYear()}-${Math.floor(date.getUTCMonth() / 3)}` : '';
export function opportunityDuplicateMatches(input: OpportunityInput, candidates: OpportunityCandidate[]): DuplicateMatch[] {
  const accountIds = new Set(input.participants.map(p => p.accountId));
  const projectIds = new Set(input.projectIds);
  return candidates.flatMap(candidate => {
    const sharedAccount = candidate.participants.some(p => accountIds.has(p.accountId));
    if (!sharedAccount) return [];
    const sameName = normalize(input.name) === normalize(candidate.name);
    const sameProject = candidate.projects.some(p => projectIds.has(p.projectId));
    const sameOwner = !!input.ownerId && input.ownerId === candidate.ownerId;
    const samePeriod = !!input.expectedCloseDate && quarter(input.expectedCloseDate) === quarter(candidate.expectedCloseDate);
    if (!sameName && !(sameProject && (sameOwner || samePeriod))) return [];
    return [{ id: candidate.id, name: candidate.name, reason: [sameName && 'same name', sameProject && 'linked Project', sameOwner && 'same owner', samePeriod && 'same close quarter'].filter(Boolean).join(', ') }];
  }).slice(0, 10);
}
export async function findOpportunityDuplicates(client: Pick<PrismaClient, 'opportunity'>, input: OpportunityInput, visibleOwnerId?: number) {
  const candidates = await client.opportunity.findMany({ where: { archivedAt: null, ...(visibleOwnerId ? { ownerId: visibleOwnerId } : {}), participants: { some: { accountId: { in: input.participants.map(p => p.accountId) } } } }, select: { id: true, name: true, ownerId: true, expectedCloseDate: true, participants: { select: { accountId: true } }, projects: { select: { projectId: true } } }, orderBy: { updatedAt: 'desc' }, take: 200 });
  return opportunityDuplicateMatches(input, candidates);
}
export type MissingForecastField = 'closeDate'|'owner'|'products';
export function missingForecastFields(input: OpportunityInput): MissingForecastField[] {
  return [!input.expectedCloseDate && 'closeDate', !input.ownerId && 'owner', (!input.lines.length || input.lines.every(line => Number(line.price) * line.quantity === 0)) && 'products'].filter(Boolean) as MissingForecastField[];
}
export async function opportunitySaveReview(client: Pick<PrismaClient, 'opportunity'>, input: OpportunityInput, form: FormData, checkDuplicates = true, visibleOwnerId?: number) {
  const [matches, missing] = await Promise.all([checkDuplicates ? findOpportunityDuplicates(client, input, visibleOwnerId) : Promise.resolve([]), Promise.resolve(missingForecastFields(input))]);
  const reviewToken = reviewFingerprint(input);
  return (matches.length || missing.length) && form.get('reviewedOpportunity') !== reviewToken ? { matches, missing, reviewToken } : null;
}
