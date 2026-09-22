import { AccountBusinessRoleCode, AccountStatus, Prisma, type PrismaClient, type UserRole } from "@prisma/client";
import type { AccountFields } from "./account-validation";
import { parseAccountForm } from "./account-validation";
import { assertPermission, type Actor } from "./authorization";

export const PAGE_SIZE = 20;
export const normalizeAccountName = (value: string) => value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
export async function findAccountNameMatches(client: Pick<PrismaClient, "account">, name: string) {
  const key = normalizeAccountName(name);
  if (!key) return [];
  const candidates = await client.account.findMany({ where: { name: { contains: name.trim().split(/\s+/)[0], mode: "insensitive" } }, select: { id: true, name: true, archivedAt: true } });
  return candidates.filter((account) => normalizeAccountName(account.name) === key);
}
export async function createAccountFromImport(client: PrismaClient, actor: Actor, form: FormData) {
  assertPermission(actor, 'users.manage');
  if (actor.role !== 'ADMIN') throw new Error('Access denied');
  const parsed = parseAccountForm(form);
  if (!parsed.value) return {kind:'validation' as const,errors:parsed.errors,message:'Please correct the Account name.'};
  const references = await checkAccountReferences(client,parsed.value);
  if (Object.keys(references).length) return {kind:'validation' as const,errors:references,message:'Please correct the Account details.'};
  const matches = await findAccountNameMatches(client,parsed.value.name);
  const available = matches.filter(account=>!account.archivedAt);
  if (matches.length===1 && available.length===1) return {kind:'existing' as const,account:{id:available[0].id,name:available[0].name}};
  if (matches.length>1) return {kind:'ambiguous' as const,matches:available.map(({id,name})=>({id,name})),message:'More than one Account has this name. Choose the correct existing Account.'};
  if (matches.length) return {kind:'validation' as const,errors:{name:'An archived Account has this name. Reactivate it before mapping.'},message:'Account could not be created.'};
  const id = await saveAccount(client,parsed.value,undefined,actor.id);
  return {kind:'created' as const,account:{id,name:parsed.value.name}};
}
export type AccountFilters = { q?: string; status?: string; role?: string; territory?: string; industry?: string; strategic?: string; page?: string; view?: string };

export function accountView(filters: AccountFilters, role?: UserRole): "all" | "my" {
  if (filters.view === "my" || filters.view === "all") return filters.view;
  return role === "SALES" || role === "SALES_MANAGER" ? "my" : "all";
}

export function accountHref(filters: AccountFilters, changes: Partial<AccountFilters> = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...filters, ...changes })) {
    if (value && key !== "page") params.set(key, value);
  }
  if (changes.page) params.set("page", changes.page);
  return `/accounts?${params}`;
}

export function accountWhere(filters: AccountFilters, currentUserId?: number): Prisma.AccountWhereInput {
  const where: Prisma.AccountWhereInput = {};
  if (accountView(filters) === "my") {
    if (!currentUserId) throw new Error("A CRM user is required for My Accounts.");
    where.ownerId = currentUserId;
  }
  if (filters.q?.trim()) where.name = { contains: filters.q.trim().slice(0, 100), mode: "insensitive" };
  if (filters.status && Object.values(AccountStatus).includes(filters.status as AccountStatus)) where.status = filters.status as AccountStatus;
  if (filters.role && Object.values(AccountBusinessRoleCode).includes(filters.role as AccountBusinessRoleCode)) where.businessRoles = { some: { role: filters.role as AccountBusinessRoleCode } };
  if (filters.territory) where.territory = filters.territory;
  if (filters.industry) where.industry = filters.industry;
  if (filters.strategic === "yes") where.strategicAccount = true;
  if (filters.strategic === "no") where.strategicAccount = false;
  return where;
}

export async function listAccounts(client: PrismaClient, filters: AccountFilters = {}, currentUserId?: number) {
  const where = accountWhere(filters, currentUserId);
  const count = await client.account.count({ where });
  const requested = Number(filters.page) || 1;
  const pages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  const page = Number.isSafeInteger(requested) ? Math.max(1, Math.min(requested, pages)) : 1;
  const accounts = await client.account.findMany({
    where, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE, orderBy: [{ name: "asc" }, { id: "asc" }],
    include: { businessRoles: true, industryCategory: true, territoryCategory: true,
      owner: { select: { id: true, firstName: true, lastName: true } },
      _count: { select: { contacts: true, opportunityMemberships: true } } },
  });
  return { accounts, count, page, pages };
}

export async function accountOptions(client: PrismaClient) {
  const [industries, territories, owners] = await Promise.all([
    client.industry.findMany({ where: { active: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    client.territory.findMany({ where: { active: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    client.user.findMany({ where: { active: true, archivedAt: null }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }], select: { id: true, firstName: true, lastName: true } }),
  ]);
  return { industries, territories, owners };
}

export async function checkAccountReferences(client: PrismaClient, input: AccountFields, id?: number) {
  const existing = id ? await client.account.findUnique({ where: { id }, select: { industry: true, territory: true } }) : null;
  const [industry, territory, owner] = await Promise.all([
    input.industry && input.industry !== existing?.industry ? client.industry.findFirst({ where: { code: input.industry, active: true } }) : null,
    input.territory && input.territory !== existing?.territory ? client.territory.findFirst({ where: { code: input.territory, active: true } }) : null,
    input.ownerId ? client.user.findFirst({ where: { id: input.ownerId, active: true, archivedAt: null } }) : null,
  ]);
  const errors: Record<string, string> = {};
  if (input.industry && input.industry !== existing?.industry && !industry) errors.industry = "Choose an active industry.";
  if (input.territory && input.territory !== existing?.territory && !territory) errors.territory = "Choose an active territory.";
  if (input.ownerId && !owner) errors.ownerId = "Choose an active owner.";
  return errors;
}

export async function saveAccount(client: PrismaClient, input: AccountFields, id?: number, actorId?: number) {
  const data = { name: input.name, status: input.status, strategicAccount: input.strategicAccount,
    industry: input.industry, territory: input.territory, ownerId: input.ownerId,
    website: input.website, phone: input.phone, addressLine1: input.addressLine1, addressLine2: input.addressLine2,
    city: input.city, stateProvince: input.stateProvince, postalCode: input.postalCode, country: input.country,
    accountType: input.roles[0] ?? null };
  return client.$transaction(async (tx) => {
    if (id) {
      const existing = await tx.account.findUnique({ where: { id }, select: { status: true } });
      if (!existing) throw new Error("Account not found.");
      if (existing.status === "ARCHIVED") throw new Error("Reactivate this account before editing it.");
      await tx.account.update({ where: { id }, data: { ...data, updatedById: actorId } });
      await tx.accountBusinessRole.deleteMany({ where: { accountId: id } });
      if (input.roles.length) await tx.accountBusinessRole.createMany({ data: input.roles.map((role) => ({ accountId: id, role })) });
      return id;
    }
    const account = await tx.account.create({ data: { ...data, createdById: actorId, updatedById: actorId, businessRoles: { create: input.roles.map((role) => ({ role })) } } });
    return account.id;
  });
}

export async function setAccountArchived(client: PrismaClient, id: number, archive: boolean) {
  return client.$transaction(async (tx) => {
    const account = await tx.account.findUnique({ where: { id }, select: { status: true } });
    if (!account) throw new Error("Account not found.");
    if (archive && account.status === "ARCHIVED") throw new Error("Account is already archived.");
    if (!archive && account.status !== "ARCHIVED") throw new Error("Account is already active.");
    await tx.account.update({ where: { id }, data: { status: archive ? "ARCHIVED" : "ACTIVE", archivedAt: archive ? new Date() : null } });
  });
}
