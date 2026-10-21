import { assertEditToken, nextUpdatedAt } from './stale-edit';
import { recordMaintenance } from './admin-maintenance';
import { MarketingPreference, Prisma, type PrismaClient } from "@prisma/client";
import { can, type Actor } from "./authorization";
import { field, optional, pageNumber, phone, positiveId, required, type Errors } from "./crm-validation";
import { parseAddress, addressFields, type Address } from "./address";
import { selectedSalesRepWhere } from './assignment-eligibility';
export const marketingPreferenceLabels: Record<MarketingPreference,string> = { UNKNOWN: "Not specified", OPTED_IN: "Opted in", OPTED_OUT: "Opted out" };
export type ContactInput = Address & { useAccountAddress?: boolean | null; accountId: number | null; firstName: string; lastName: string; title: string | null; email: string | null; phone: string | null; mobile: string | null; active: boolean; isPrimary: boolean; marketingPreference: MarketingPreference };
type ContactWriteClient = Pick<Prisma.TransactionClient,"account"|"contact">;
export function parseContact(form: FormData) {
  const errors: Errors = {};
  const rawAccountId = field(form, "accountId");
  const accountId = rawAccountId ? positiveId(rawAccountId) : null;
  if (rawAccountId && !accountId) errors.accountId = "Choose a valid account.";
  if (!accountId && field(form, 'accountIdQuery')) errors.accountId = 'Select an Account from the suggestions.';
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
  const useAccountAddress = accountId !== null && (field(form, "addressMode") === "account" || !form.has("addressMode"));
  if (form.has("addressMode") && !["account", "different"].includes(field(form, "addressMode"))) errors.addressMode = "Choose an address option.";
  const address = useAccountAddress ? Object.fromEntries(addressFields.map(([key]) => [key, null])) as Address : parseAddress(form, errors);
  if (isPrimary && !active) errors.isPrimary = "A primary contact must be active.";
  if (isPrimary && !accountId) errors.isPrimary = "Choose an account for a primary contact.";
  return { errors, value: Object.keys(errors).length ? undefined : { accountId, firstName, lastName, title, email, phone: office, mobile, active, isPrimary, marketingPreference, useAccountAddress, ...address } satisfies ContactInput };
}
export async function saveContactRecord(tx: ContactWriteClient, input: ContactInput, id?: number, actor?: Actor, editToken?: string) {
    if (id && actor && !can(actor, 'contacts.write')) throw new Error('Access denied');
    if (input.accountId !== null) {
      const account = await tx.account.findUnique({ where: { id: input.accountId }, select: { status: true, archivedAt: true } });
      if (!account || account.status !== "ACTIVE" || account.archivedAt) throw new Error("Choose an active account.");
    }
    const existing = id ? await tx.contact.findUnique({ where: { id } }) : null;
    if (id) { if (!existing) throw new Error("Contact not found."); if (existing.archivedAt) throw new Error("Reactivate this contact before editing it."); }
    if (id && editToken !== undefined) assertEditToken(existing!.updatedAt, editToken);
    const preferenceChanged = id ? existing!.marketingPreference !== input.marketingPreference : input.marketingPreference !== MarketingPreference.UNKNOWN;
    if (preferenceChanged && (!actor || !can(actor,"contacts.write"))) throw new Error("Access denied");
    if (input.isPrimary && input.accountId !== null) {
      const primaries = await tx.contact.findMany({ where: { accountId: input.accountId, isPrimary: true, ...(id ? { id: { not: id } } : {}) }, select: { id: true, updatedAt: true } });
      for (const primary of primaries) await tx.contact.update({ where: { id: primary.id, updatedAt: primary.updatedAt }, data: { isPrimary: false, updatedAt: nextUpdatedAt(primary.updatedAt) } });
    }
    const audit = preferenceChanged ? { marketingPreferenceUpdatedAt: new Date(), marketingPreferenceUpdatedByUserId: actor!.id } : {};
    const address = input.useAccountAddress && existing ? Object.fromEntries(addressFields.map(([key]) => [key, existing[key]])) as Address : input.useAccountAddress ? Object.fromEntries(addressFields.map(([key]) => [key, null])) as Address : input;
    const record = id ? await tx.contact.update({ where: { id, updatedAt: editToken !== undefined ? new Date(editToken) : existing!.updatedAt }, data: {...input,...address,...audit, updatedAt: nextUpdatedAt(existing!.updatedAt)} }) : await tx.contact.create({ data: {...input,...address,...audit} });
    return record.id;
}
/** Browser actions require the form-open token; trusted callers compare the current row. */
export async function saveContact(client: PrismaClient, input: ContactInput, id?: number, actor?: Actor, editToken?: string) {
  return client.$transaction(tx => saveContactRecord(tx, input, id, actor, editToken));
}
export async function setContactState(client: PrismaClient, id: number, state: "active" | "inactive" | "archived", actorId?: number) {
  const run = async (tx: Prisma.TransactionClient) => {
    const existing = await tx.contact.findUnique({ where: { id } });
    if (!existing) throw new Error("Contact not found.");
    if (state === "active" && existing.accountId !== null) {
      const account = await tx.account.findUnique({ where: { id: existing.accountId }, select: { status: true } });
      if (account?.status !== "ACTIVE") throw new Error("Reactivate the account before activating this contact.");
    }
    await tx.contact.update({ where: { id, updatedAt: existing.updatedAt }, data: {
      active: state === "active", archivedAt: state === "archived" ? new Date() : null,
      isPrimary: state === "active" ? existing.isPrimary && !existing.archivedAt : false,
      updatedAt: nextUpdatedAt(existing.updatedAt),
      ...(actorId ? { updatedById: actorId, archivedById: state === "archived" ? actorId : null } : {}),
    } });
    if (actorId && (Boolean(existing.archivedAt) !== (state === "archived") || existing.active !== (state === "active"))) {
      await recordMaintenance(tx, actorId, "Contact", state === "archived" ? "Archive" : existing.archivedAt ? "Restore" : state === "active" ? "Activate" : "Deactivate", [id]);
    }
  };
  return actorId ? client.$transaction(run) : run(client);
}
export type ContactSort = "name" | "account" | "title" | "email" | "status";
export type ContactFilters = { q?: string; active?: string; accountId?: string; salesRepId?: string; marketingPreference?: string; title?: string; primary?: string; assignment?: string; sort?: string; dir?: string; page?: string; pageSize?: string };
const listQueryKeys = ["q", "active", "accountId", "salesRepId", "marketingPreference", "title", "primary", "assignment", "sort", "dir", "pageSize"] as const;
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
  // The default ("Not Archived") includes active and inactive Contacts with a working Account or no Account.
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
  const salesRep = selectedSalesRepWhere(filters.salesRepId);
  if (salesRep) where.AND = [...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []), { account: { is: { owner: { is: salesRep } } } }];
  return where;
}
export async function listContacts(client: PrismaClient, filters: ContactFilters) {
  const where = contactWhere(filters), count = await client.contact.count({ where });
  const { pageSize } = contactListState(filters);
  const { page, pages } = pageNumber(filters.page, count, pageSize);
  const contacts = await client.contact.findMany({ where, include: { account: { select: { name: true } } }, orderBy: contactOrderBy(filters), skip: (page - 1) * pageSize, take: pageSize });
  return { contacts, count, page, pages, pageSize };
}
