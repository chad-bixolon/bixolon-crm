import { AccountBusinessRoleCode, AccountStatus, Prisma, type PrismaClient } from "@prisma/client";
import type { AccountFields } from "./account-validation";

export const PAGE_SIZE = 20;
export type AccountFilters = { q?: string; status?: string; role?: string; territory?: string; industry?: string; strategic?: string; page?: string };

export function accountWhere(filters: AccountFilters): Prisma.AccountWhereInput {
  const where: Prisma.AccountWhereInput = {};
  if (filters.q?.trim()) where.name = { contains: filters.q.trim().slice(0, 100), mode: "insensitive" };
  if (filters.status && Object.values(AccountStatus).includes(filters.status as AccountStatus)) where.status = filters.status as AccountStatus;
  if (filters.role && Object.values(AccountBusinessRoleCode).includes(filters.role as AccountBusinessRoleCode)) where.businessRoles = { some: { role: filters.role as AccountBusinessRoleCode } };
  if (filters.territory) where.territory = filters.territory;
  if (filters.industry) where.industry = filters.industry;
  if (filters.strategic === "yes") where.strategicAccount = true;
  if (filters.strategic === "no") where.strategicAccount = false;
  return where;
}

export async function listAccounts(client: PrismaClient, filters: AccountFilters = {}) {
  const where = accountWhere(filters);
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

export async function saveAccount(client: PrismaClient, input: AccountFields, id?: number) {
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
      await tx.account.update({ where: { id }, data });
      await tx.accountBusinessRole.deleteMany({ where: { accountId: id } });
      if (input.roles.length) await tx.accountBusinessRole.createMany({ data: input.roles.map((role) => ({ accountId: id, role })) });
      return id;
    }
    const account = await tx.account.create({ data: { ...data, businessRoles: { create: input.roles.map((role) => ({ role })) } } });
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
