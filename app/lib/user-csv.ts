import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { Prisma, type PrismaClient, type User } from '@prisma/client';
import { assertPermission, type Actor } from './authorization';
import { parseImportCsv } from './import-csv';
import { parseUser, assertUserAdministrationTarget, saveUserInTransaction, lastAdminMessage, type UserInput } from './users';
import { userChangeImpact, impactConfirmation, type UserImpact } from './user-lifecycle';
import { roleLabels } from './role-labels';
import { archivedWhere, type RecordVisibility } from './record-visibility';

export const userCsvHeaders = ['First Name', 'Last Name', 'Email', 'Role', 'Active', 'Timezone'];
export const userCsvLimits = { bytes: 500_000, rows: 500, cell: 320 };
export type UserCsvRow = { row: number; email: string; name: string; action: 'Create' | 'Update' | 'Unchanged' | 'Error'; messages: string[]; impact: UserImpact[]; current?: string; proposed?: string; id?: number; value?: UserInput; confirmation?: string };
export type UserCsvPreview = { rows: UserCsvRow[]; errors: string[]; digest: string };
const normalize = (email: string) => email.trim().toLowerCase();
const fields = ['firstName', 'lastName', 'role', 'active', 'timeZone'] as const;
const status = (u: { role: keyof typeof roleLabels; active: boolean }) => `${roleLabels[u.role]} / ${u.active ? 'Active' : 'Inactive'}`;
export function parseUserCsv(csv: string) {
  if (Buffer.byteLength(csv, 'utf8') > userCsvLimits.bytes) throw new Error('Choose a UTF-8 CSV file no larger than 500 KB.');
  const parsed = parseImportCsv(csv, userCsvHeaders.map(h => h.toLowerCase()), ['first name', 'last name', 'email', 'role']);
  if (!parsed.rows.length && !parsed.errors.length) parsed.errors.push('Include at least one user row.');
  if (parsed.rows.length > userCsvLimits.rows) throw new Error('Import at most 500 users at a time.');
  return parsed;
}
export async function previewUserCsv(tx: Prisma.TransactionClient, actor: Actor, csv: string): Promise<UserCsvPreview> {
  assertPermission(actor, 'users.import');
  // Browser form submission normalizes line endings; bind the review to canonical CSV text.
  csv = csv.replace(/\r\n?/g, '\n');
  const parsed = parseUserCsv(csv);
  const users = await tx.user.findMany({ orderBy: { id: 'asc' } });
  const emails = new Map<string, User[]>();
  for (const user of users) emails.set(normalize(user.email), [...(emails.get(normalize(user.email)) ?? []), user]);
  const counts = new Map<string, number>();
  for (const row of parsed.rows) { const email = normalize((row.values as Record<string,string>).email ?? ''); counts.set(email, (counts.get(email) ?? 0) + 1); }
  const rows: UserCsvRow[] = [];
  for (const raw of parsed.rows) {
    const v = raw.values as Record<string,string>, email = normalize(v.email ?? '');
    const row: UserCsvRow = { row: raw.line, email, name: `${v['first name'] ?? ''} ${v['last name'] ?? ''}`, action: 'Error', messages: [], impact: [] };
    rows.push(row);
    const matches = emails.get(email) ?? [], existing = matches[0];
    if (Object.values(v).some(value => value.length > userCsvLimits.cell || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffd]/u.test(value))) row.messages.push('A value is too long or contains invalid text. Maximum column length is 320 characters.');
    if ((counts.get(email) ?? 0) > 1) row.messages.push('Email appears more than once in this file.');
    if (matches.length > 1) row.messages.push('Multiple CRM users have this email. Resolve the conflict before importing.');
    if (existing?.archivedAt) row.messages.push('Archived users cannot be changed or reactivated by import.');
    if (existing) { row.id = existing.id; row.current = status(existing); }
    const active = v.active?.toLowerCase();
    if (active && !['true','false','yes','no'].includes(active)) row.messages.push('Active must be true, false, yes, or no.');
    if (!active && !existing) row.messages.push('Active is required for new users.');
    if (!v.timezone && !existing) row.messages.push('Timezone is required for new users (for example UTC or Asia/Seoul).');
    const role = Object.entries(roleLabels).find(([key,label]) => key === v.role?.toUpperCase() || label.toLowerCase() === v.role?.toLowerCase())?.[0] ?? v.role;
    const form = new FormData();
    for (const [key,value] of Object.entries({firstName:v['first name'], lastName:v['last name'], email, role, active: active ? String(active === 'true' || active === 'yes') : String(existing?.active ?? false), timeZone:v.timezone || existing?.timeZone || ''})) form.set(key,value ?? '');
    const input = parseUser(form);
    row.messages.push(...Object.values(input.errors));
    if (!input.value || row.messages.length) continue;
    // Email is a match key for existing users, never an imported change to their address.
    row.value = existing ? { ...input.value, email: existing.email } : input.value;
    row.proposed = status(row.value);
    try { assertUserAdministrationTarget(actor, existing ?? null, row.value); } catch (error) { row.messages.push((error as Error).message); continue; }
    row.action = !existing ? 'Create' : fields.some(key => existing[key] !== row.value![key]) ? 'Update' : 'Unchanged';
    if (row.action !== 'Unchanged') {
      if (row.value.role === 'ADMIN' && existing?.role !== 'ADMIN') row.messages.push('Grants Administrator access.');
      if (existing?.role === 'ADMIN' && row.value.role !== 'ADMIN') row.messages.push('Removes Administrator access.');
      if (existing?.active && !row.value.active) row.messages.push('Deactivates this user.');
      if (existing && existing.role !== row.value.role) row.messages.push(`Role changes from ${roleLabels[existing.role]} to ${roleLabels[row.value.role]}. Review assignment eligibility.`);
      if (existing) {
        const next = { ...existing, ...row.value };
        row.impact = await userChangeImpact(tx, actor, existing, next);
        row.confirmation = impactConfirmation(existing, next, row.impact);
      }
    }
  }
  const finalUsers = users.map(u => ({ ...u, ...rows.find(r => r.id === u.id && r.action !== 'Error')?.value }));
  const hasAdmin = finalUsers.some(u => u.role === 'ADMIN' && u.active && !u.archivedAt) || rows.some(r => r.action === 'Create' && r.value?.role === 'ADMIN' && r.value.active);
  if (!hasAdmin) parsed.errors.push(lastAdminMessage);
  // Bind review to every user version plus impact counts, including the actor and final-Admin population.
  const digest = createHash('sha256').update(JSON.stringify({ csv, users, rows, errors: parsed.errors })).digest('hex');
  return { rows, errors: parsed.errors, digest };
}
function signingKey() { const key = process.env.AUTH_SECRET; if (!key) throw new Error('Import confirmation is unavailable. Contact your administrator.'); return key; }
export function signUserCsvPreview(actorId: number, digest: string) {
  const data = `${actorId}.${Date.now() + 15 * 60_000}.${digest}`;
  return `${data}.${createHmac('sha256', signingKey()).update(data).digest('hex')}`;
}
function verifyPreview(token: string, actorId: number, digest: string) {
  const [id, expires, hash, signature] = token.split('.');
  const expected = createHmac('sha256', signingKey()).update(`${id}.${expires}.${hash}`).digest('hex');
  if (id !== String(actorId) || !Number.isFinite(Number(expires)) || Number(expires) < Date.now() || hash !== digest || !signature || signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature),Buffer.from(expected))) throw new Error('This preview has expired or users or active work have changed. Upload the file and review a fresh preview.');
}
export async function reviewUserCsv(client: PrismaClient, actor: Actor, csv: string) {
  assertPermission(actor, 'users.import');
  return client.$transaction(async tx => {
    const persisted = await tx.user.findUnique({ where: { id: actor.id } });
    assertPermission(persisted, 'users.import');
    return previewUserCsv(tx, persisted!, csv);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 60_000 });
}
export async function applyUserCsv(client: PrismaClient, actor: Actor, csv: string, token: string) {
  assertPermission(actor, 'users.import');
  return client.$transaction(async tx => {
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(72341001)`;
    await tx.$queryRaw`SELECT id FROM "User" ORDER BY id FOR UPDATE`;
    const persisted = await tx.user.findUnique({ where: { id: actor.id } });
    assertPermission(persisted, 'users.import');
    const preview = await previewUserCsv(tx, persisted!, csv);
    verifyPreview(token, actor.id, preview.digest);
    if (preview.errors.length || preview.rows.some(row => row.action === 'Error')) throw new Error('Correct all errors before confirming the import.');
    // Install replacement Admins before removals so the shared per-user guard also holds.
    const ordered = [...preview.rows].sort((a,b) => Number(b.value?.role === 'ADMIN' && b.value.active) - Number(a.value?.role === 'ADMIN' && a.value.active));
    for (const row of ordered) if (row.action === 'Create' || row.action === 'Update') await saveUserInTransaction(tx, persisted!, row.value!, row.id, row.confirmation);
    return preview;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 60_000 });
}
export function spreadsheetCsv(rows: unknown[][]) {
  return '\uFEFF' + rows.map(row => row.map(value => {
    let text = String(value ?? '');
    if (/^[\s\u0000-\u001f]*[=+@-]|^[\t\r\n]/u.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"','""') + '"';
  }).join(',')).join('\r\n') + '\r\n';
}
export async function exportUserCsv(client: PrismaClient, actor: Actor, visibility: RecordVisibility) {
  assertPermission(actor, 'users.export');
  return client.$transaction(async tx => {
    const persisted = await tx.user.findUnique({ where: { id: actor.id } });
    assertPermission(persisted, 'users.export');
    const users = await tx.user.findMany({ where: archivedWhere(visibility), orderBy: [{lastName:'asc'},{firstName:'asc'},{id:'asc'}], include: { identities: { select: { id: true } } } });
    return spreadsheetCsv([['User ID',...userCsvHeaders.slice(0,5),'Archived','Timezone','User Administration Access','Google sign-in status','Created At','Updated At'], ...users.map(u => [u.id,u.firstName,u.lastName,u.email,u.role,u.active,Boolean(u.archivedAt),u.timeZone,u.delegatedUserAdministrationEnabled,u.identities.length ? 'Linked' : 'Not linked',u.createdAt.toISOString(),u.updatedAt.toISOString()])]);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}
