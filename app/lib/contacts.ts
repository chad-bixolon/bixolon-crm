import { Prisma, type PrismaClient } from "@prisma/client";
import { field, optional, pageNumber, phone, positiveId, required, type Errors } from "./crm-validation";
export type ContactInput = { accountId: number; firstName: string; lastName: string; title: string | null; email: string | null; phone: string | null; mobile: string | null; active: boolean; isPrimary: boolean };
export function parseContact(form: FormData) {
  const errors: Errors = {};
  const accountId = positiveId(field(form, "accountId"));
  if (!accountId) errors.accountId = "Choose an account.";
  const firstName = required(form, "firstName", "First name", 100, errors);
  const lastName = required(form, "lastName", "Last name", 100, errors);
  const title = optional(form, "title", 200, errors);
  const email = optional(form, "email", 254, errors);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = "Enter a valid email address.";
  const office = optional(form, "phone", 50, errors); phone(office, "phone", errors);
  const mobile = optional(form, "mobile", 50, errors); phone(mobile, "mobile", errors);
  const active = field(form, "active") !== "false";
  const isPrimary = form.has("isPrimary");
  if (isPrimary && !active) errors.isPrimary = "A primary contact must be active.";
  return { errors, value: Object.keys(errors).length ? undefined : { accountId: accountId!, firstName, lastName, title, email, phone: office, mobile, active, isPrimary } satisfies ContactInput };
}
export async function saveContact(client: PrismaClient, input: ContactInput, id?: number) {
  return client.$transaction(async (tx) => {
    const account = await tx.account.findUnique({ where: { id: input.accountId }, select: { status: true } });
    if (!account || account.status !== "ACTIVE") throw new Error("Choose an active account.");
    if (id) { const existing = await tx.contact.findUnique({ where: { id } }); if (!existing) throw new Error("Contact not found."); if (existing.archivedAt) throw new Error("Reactivate this contact before editing it."); }
    if (input.isPrimary) await tx.contact.updateMany({ where: { accountId: input.accountId, isPrimary: true, ...(id ? { id: { not: id } } : {}) }, data: { isPrimary: false } });
    const record = id ? await tx.contact.update({ where: { id }, data: input }) : await tx.contact.create({ data: input });
    return record.id;
  });
}
export async function setContactState(client: PrismaClient, id: number, state: "active" | "inactive" | "archived") {
  const existing = await client.contact.findUnique({ where: { id } });
  if (!existing) throw new Error("Contact not found.");
  if (state === "active") {
    const account = await client.account.findUnique({ where: { id: existing.accountId }, select: { status: true } });
    if (account?.status !== "ACTIVE") throw new Error("Reactivate the account before activating this contact.");
  }
  await client.contact.update({ where: { id }, data: { active: state === "active", archivedAt: state === "archived" ? new Date() : null, isPrimary: state === "active" ? existing.isPrimary && !existing.archivedAt : false } });
}
export type ContactFilters = { q?: string; active?: string; accountId?: string; page?: string };
export function contactWhere(filters: ContactFilters): Prisma.ContactWhereInput {
  const where: Prisma.ContactWhereInput = {};
  if (filters.q?.trim()) { const q = filters.q.trim().slice(0, 100); where.OR = [{ firstName: { contains: q, mode: "insensitive" } }, { lastName: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }]; }
  if (filters.active === "active") { where.active = true; where.archivedAt = null; }
  if (filters.active === "inactive") { where.active = false; where.archivedAt = null; }
  if (filters.active === "archived") where.archivedAt = { not: null };
  const accountId = positiveId(filters.accountId ?? ""); if (accountId) where.accountId = accountId;
  return where;
}
export async function listContacts(client: PrismaClient, filters: ContactFilters) {
  const where = contactWhere(filters), count = await client.contact.count({ where });
  const { page, pages } = pageNumber(filters.page, count);
  const contacts = await client.contact.findMany({ where, include: { account: { select: { name: true } } }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }, { id: "asc" }], skip: (page - 1) * 20, take: 20 });
  return { contacts, count, page, pages };
}
