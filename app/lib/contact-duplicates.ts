import type { PrismaClient } from '@prisma/client';
import type { ContactInput } from './contacts';
import { reviewFingerprint } from './sales-readiness';

type ContactCandidate = {
  id: number; firstName: string; lastName: string; email: string | null; accountId: number | null;
  account: { name: string } | null; title: string | null; active: boolean; archivedAt: Date | null;
};
export type ContactDuplicateMatch = {
  id: number; name: string; email: string | null; accountName: string | null; title: string | null;
  archived: boolean; inactive: boolean; reason: 'email' | 'same-account-name' | 'unassigned-name';
};

const normalizeText = (value: string) => value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
const normalizeEmail = (value: string | null) => value?.trim().toLowerCase() ?? '';

export function contactIdentityChanged(previous: Pick<ContactInput, 'firstName' | 'lastName' | 'email' | 'accountId'>, input: ContactInput) {
  return normalizeText(previous.firstName) !== normalizeText(input.firstName)
    || normalizeText(previous.lastName) !== normalizeText(input.lastName)
    || normalizeEmail(previous.email) !== normalizeEmail(input.email)
    || previous.accountId !== input.accountId;
}

export function contactDuplicateMatches(input: ContactInput, candidates: ContactCandidate[], editingId?: number): ContactDuplicateMatch[] {
  const first = normalizeText(input.firstName), last = normalizeText(input.lastName), email = normalizeEmail(input.email);
  return candidates.flatMap(candidate => {
    if (candidate.id === editingId) return [];
    const exactEmail = !!email && normalizeEmail(candidate.email) === email;
    const sameName = first === normalizeText(candidate.firstName) && last === normalizeText(candidate.lastName);
    const sameAccount = input.accountId !== null && input.accountId === candidate.accountId;
    const unassigned = input.accountId === null || candidate.accountId === null;
    const reason = exactEmail ? 'email' : sameName && sameAccount ? 'same-account-name' : sameName && unassigned ? 'unassigned-name' : null;
    if (!reason) return [];
    return [{ id: candidate.id, name: `${candidate.firstName} ${candidate.lastName}`, email: candidate.email,
      accountName: candidate.account?.name ?? null, title: candidate.title, archived: !!candidate.archivedAt,
      inactive: !candidate.archivedAt && !candidate.active, reason } satisfies ContactDuplicateMatch];
  }).sort((a, b) => ({ email: 3, 'same-account-name': 2, 'unassigned-name': 1 })[b.reason] - ({ email: 3, 'same-account-name': 2, 'unassigned-name': 1 })[a.reason]).slice(0, 10);
}

export async function findContactDuplicates(client: Pick<PrismaClient, 'contact'>, input: ContactInput, editingId?: number) {
  const email = normalizeEmail(input.email);
  const firstToken = normalizeText(input.firstName).split(' ')[0];
  const lastToken = normalizeText(input.lastName).split(' ')[0];
  const select = { id: true, firstName: true, lastName: true, email: true, accountId: true, account: { select: { name: true } }, title: true, active: true, archivedAt: true } as const;
  const [emailCandidates, nameCandidates] = await Promise.all([
    email ? client.contact.findMany({ where: { email: { contains: email, mode: 'insensitive' } }, select }) : Promise.resolve([]),
    client.contact.findMany({ where: { firstName: { contains: firstToken, mode: 'insensitive' }, lastName: { contains: lastToken, mode: 'insensitive' } }, select, orderBy: { updatedAt: 'desc' }, take: 500 }),
  ]);
  return contactDuplicateMatches(input, [...new Map([...emailCandidates, ...nameCandidates].map(candidate => [candidate.id, candidate])).values()], editingId);
}

export async function contactSaveReview(client: Pick<PrismaClient, 'contact'>, input: ContactInput, form: FormData, editingId?: number, previous?: Pick<ContactInput, 'firstName' | 'lastName' | 'email' | 'accountId'> | null) {
  if (previous && !contactIdentityChanged(previous, input)) return null;
  const matches = await findContactDuplicates(client, input, editingId);
  const reviewToken = reviewFingerprint({ editingId: editingId ?? null, input, matches: matches.map(match => [match.id, match.reason, match.archived, match.inactive]) });
  return matches.length && form.get('reviewedContact') !== reviewToken ? { matches, reviewToken } : null;
}
