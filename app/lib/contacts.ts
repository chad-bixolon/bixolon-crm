import { MarketingPreference, Prisma, type PrismaClient } from "@prisma/client";
import { can, type Actor } from "./authorization";
import { field, optional, pageNumber, phone, positiveId, required, type Errors } from "./crm-validation";
import { parseAddress, type Address } from "./address";
export const marketingPreferenceLabels: Record<MarketingPreference,string> = { UNKNOWN: "Not specified", OPTED_IN: "Opted in", OPTED_OUT: "Opted out" };
export type ContactInput = Address & { accountId: number | null; firstName: string; lastName: string; title: string | null; email: string | null; phone: string | null; mobile: string | null; active: boolean; isPrimary: boolean; marketingPreference: MarketingPreference };
type ContactWriteClient = Pick<Prisma.TransactionClient,"account"|"contact">;
export function parseContact(form: FormData) {
  const errors: Errors = {};
  const rawAccountId = field(form, "accountId");
  const accountId = rawAccountId ? positiveId(rawAccountId) : null;
  if (rawAccountId && !accountId) errors.accountId = "Choose a valid account.";
  const firstName = required(form, "firstName", "First name", 100, errors);
  const lastName = required(form, "lastName", "Last name", 100, errors);
  const title = optional(form, "title", 200, errors);
  const email = optional(form, "email", 254, errors);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = "Enter a valid email address.";
  const office = optional(form, "phone", 50, errors); phone(office, "phone", errors);
  const mobile = optional(form, "mobile", 50, errors); phone(mobile, "mobile", errors);
  const active = field(form, "active") !== "false";
  const isPrimary = form.has("isPrimary");
  const marketingPreference = Object.values(MarketingPreference).includes(field(form,"marketingPreference") as MarketingPreference) ? field(form,"marketingPreference") as MarketingPreference : MarketingPreference.UNKNOWN;
  const address = parseAddress(form, errors);
  if (isPrimary && !active) errors.isPrimary = "A primary contact must be active.";
  if (isPrimary && !accountId) errors.isPrimary = "Choose an account for a primary contact.";
  return { errors, value: Object.keys(errors).length ? undefined : { accountId, firstName, lastName, title, email, phone: office, mobile, active, isPrimary, marketingPreference, ...address } satisfies ContactInput };
}
export async function saveContactRecord(tx: ContactWriteClient, input: ContactInput, id?: number, actor?: Actor) {
    if (input.accountId !== null) {
      const account = await tx.account.findUnique({ where: { id: input.accountId }, select: { status: true } });
      if (!account || account.status !== "ACTIVE") throw new Error("Choose an active account.");
    }
    const existing = id ? await tx.contact.findUnique({ where: { id } }) : null;
    if (id) { if (!existing) throw new Error("Contact not found."); if (existing.archivedAt) throw new Error("Reactivate this contact before editing it."); }
    const preferenceChanged = id ? existing!.marketingPreference !== input.marketingPreference : input.marketingPreference !== MarketingPreference.UNKNOWN;
    if (preferenceChanged && (!actor || !can(actor,"contacts.write"))) throw new Error("Access denied");
    if (input.isPrimary && input.accountId !== null) await tx.contact.updateMany({ where: { accountId: input.accountId, isPrimary: true, ...(id ? { id: { not: id } } : {}) }, data: { isPrimary: false } });
    const audit = preferenceChanged ? { marketingPreferenceUpdatedAt: new Date(), marketingPreferenceUpdatedByUserId: actor!.id } : {};
    const record = id ? await tx.contact.update({ where: { id }, data: {...input,...audit} }) : await tx.contact.create({ data: {...input,...audit} });
    return record.id;
}
export async function saveContact(client: PrismaClient, input: ContactInput, id?: number, actor?: Actor) {
  return client.$transaction(tx => saveContactRecord(tx, input, id, actor));
}
export async function setContactState(client: PrismaClient, id: number, state: "active" | "inactive" | "archived") {
  const existing = await client.contact.findUnique({ where: { id } });
  if (!existing) throw new Error("Contact not found.");
  if (state === "active") {
    if (existing.accountId !== null) {
      const account = await client.account.findUnique({ where: { id: existing.accountId }, select: { status: true } });
      if (account?.status !== "ACTIVE") throw new Error("Reactivate the account before activating this contact.");
    }
  }
  await client.contact.update({ where: { id }, data: { active: state === "active", archivedAt: state === "archived" ? new Date() : null, isPrimary: state === "active" ? existing.isPrimary && !existing.archivedAt : false } });
}
export type ContactSort = "name" | "account" | "title" | "email" | "status";
export type ContactFilters = { q?: string; active?: string; accountId?: string; marketingPreference?: string; title?: string; primary?: string; assignment?: string; sort?: string; dir?: string; page?: string; pageSize?: string };
const listQueryKeys = ["q", "active", "accountId", "marketingPreference", "title", "primary", "assignment", "sort", "dir", "pageSize"] as const;
export function contactListUrl(filters: ContactFilters, changes: Record<string, string | undefined> = {}) {
  const params = new URLSearchParams();
  for (const key of listQueryKeys) if (filters[key]) params.set(key, filters[key]);
  for (const [key, value] of Object.entries(changes)) { if (value) params.set(key, value); else params.delete(key); }
  return `/contacts${params.size ? `?${params}` : ""}`;
}
export function contactListState(filters: ContactFilters) {
  const pageSize = [25, 50, 100].includes(Number(filters.pageSize)) ? Number(filters.pageSize) : 25;
  const sort = (["name", "account", "title", "email", "status"] as const).find(value => value === filters.sort);
  const dir: Prisma.SortOrder = filters.dir === "desc" ? "desc" : "asc";
  return { pageSize, sort, dir };
}
export function contactOrderBy(filters: ContactFilters): Prisma.ContactOrderByWithRelationInput[] {
  const { sort, dir } = contactListState(filters);
  if (sort === "account") return [{ account: { name: dir } }, { lastName: "asc" }, { firstName: "asc" }, { id: "asc" }];
  if (sort === "title" || sort === "email") return [{ [sort]: { sort: dir, nulls: "last" } }, { lastName: "asc" }, { firstName: "asc" }, { id: "asc" }];
  if (sort === "status") return [{ archivedAt: { sort: dir, nulls: dir === "asc" ? "first" : "last" } }, { active: dir }, { lastName: "asc" }, { firstName: "asc" }, { id: "asc" }];
  return [{ lastName: sort === "name" ? dir : "asc" }, { firstName: sort === "name" ? dir : "asc" }, { id: "asc" }];
}
export function contactWhere(filters: ContactFilters): Prisma.ContactWhereInput {
  const where: Prisma.ContactWhereInput = { archivedAt: null, OR: [{ accountId: null }, { account: { is: { archivedAt: null, status: 'ACTIVE' } } }] };
  if (filters.q?.trim()) {
    const q = filters.q.trim().slice(0, 100);
    where.AND = [{ OR: [
      { firstName: { contains: q, mode: 'insensitive' } },
      { lastName: { contains: q, mode: 'insensitive' } },
      { email: { contains: q, mode: 'insensitive' } },
      { title: { contains: q, mode: 'insensitive' } },
    ] }];
  }
  if (filters.active === "all") { delete where.archivedAt; delete where.OR; }
  if (filters.active === "active") { where.active = true; where.archivedAt = null; }
  if (filters.active === "inactive") { where.active = false; where.archivedAt = null; }
  if (filters.active === "archived") { where.archivedAt = { not: null }; delete where.OR; }
  if (filters.accountId === "unassigned") where.accountId = null;
  else { const accountId = positiveId(filters.accountId ?? ""); if (accountId) where.accountId = accountId; }
  if (Object.values(MarketingPreference).includes(filters.marketingPreference as MarketingPreference)) where.marketingPreference = filters.marketingPreference as MarketingPreference;
  if (filters.title?.trim()) where.title = { contains: filters.title.trim().slice(0, 200), mode: "insensitive" };
  if (filters.primary === "yes") where.isPrimary = true;
  if (filters.primary === "no") where.isPrimary = false;
  if (filters.assignment === "assigned" && where.accountId === undefined) where.accountId = { not: null };
  if (filters.assignment === "unassigned" && where.accountId === undefined) where.accountId = null;
  if (filters.assignment === "assigned" && where.accountId === null) where.AND = [...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []), { accountId: { not: null } }];
  if (filters.assignment === "unassigned" && where.accountId !== undefined && where.accountId !== null) where.AND = [...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []), { accountId: null }];
  return where;
}
export async function listContacts(client: PrismaClient, filters: ContactFilters) {
  const where = contactWhere(filters), count = await client.contact.count({ where });
  const { pageSize } = contactListState(filters);
  const { page, pages } = pageNumber(filters.page, count, pageSize);
  const contacts = await client.contact.findMany({ where, include: { account: { select: { name: true } } }, orderBy: contactOrderBy(filters), skip: (page - 1) * pageSize, take: pageSize });
  return { contacts, count, page, pages, pageSize };
}
