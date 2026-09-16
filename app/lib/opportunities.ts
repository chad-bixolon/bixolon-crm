import { ForecastCategory, OpportunityPartyRole, Prisma, type PrismaClient } from "@prisma/client";
import { field, optional, pageNumber, positiveId, required, type Errors } from "./crm-validation";
import { archivedWhere, recordVisibility } from "./record-visibility";
export type Participant = { accountId: number; roles: OpportunityPartyRole[] };
export type Line = { id?: number; productId: number; quantity: number; price: string };
export type OpportunityInput = { name: string; description: string | null; ownerId: number | null; stageId: number; expectedCloseDate: Date | null; probability: number | null; forecastCategory: ForecastCategory | null; currencyCode: string; participants: Participant[]; lines: Line[] };
export function parseOpportunity(form: FormData) {
  const errors: Errors = {};
  const name = required(form, "name", "Opportunity name", 200, errors);
  const description = optional(form, "description", 5000, errors);
  const ownerRaw = field(form, "ownerId"), ownerId = ownerRaw ? positiveId(ownerRaw) : null;
  if (ownerRaw && !ownerId) errors.ownerId = "Choose a valid owner.";
  const stageId = positiveId(field(form, "stageId")); if (!stageId) errors.stageId = "Choose a sales stage.";
  const dateRaw = field(form, "expectedCloseDate");
  const expectedCloseDate = dateRaw && /^\d{4}-\d{2}-\d{2}$/.test(dateRaw) ? new Date(`${dateRaw}T12:00:00.000Z`) : null;
  if (dateRaw && (!expectedCloseDate || Number.isNaN(expectedCloseDate.getTime()) || expectedCloseDate.toISOString().slice(0, 10) !== dateRaw)) errors.expectedCloseDate = "Choose a valid date.";
  const probabilityRaw = field(form, "probability"); const probability = probabilityRaw === "" ? null : Number(probabilityRaw);
  if (probability !== null && (!Number.isInteger(probability) || probability < 0 || probability > 100)) errors.probability = "Use a whole percentage from 0 to 100.";
  const forecastRaw = field(form, "forecastCategory");
  const forecastCategory = forecastRaw && Object.values(ForecastCategory).includes(forecastRaw as ForecastCategory) ? forecastRaw as ForecastCategory : null;
  if (forecastRaw && !forecastCategory) errors.forecastCategory = "Choose a valid forecast category.";
  const currencyCode = field(form, "currencyCode"); if (!/^[A-Z]{3}$/.test(currencyCode)) errors.currencyCode = "Choose a currency.";
  const accountIds = form.getAll("accountId").map(String);
  const rolesRaw = form.getAll("participantRoles").map(String);
  const participants: Participant[] = [];
  for (let i = 0; i < accountIds.length; i++) {
    const accountId = positiveId(accountIds[i]);
    const roles = (rolesRaw[i] ?? "").split(",").filter(Boolean);
    if (!accountId || !roles.length || roles.some((role) => !Object.values(OpportunityPartyRole).includes(role as OpportunityPartyRole))) { errors.participants = "Each participating account needs at least one valid role."; continue; }
    if (participants.some((p) => p.accountId === accountId)) { errors.participants = "Choose each account only once."; continue; }
    participants.push({ accountId, roles: [...new Set(roles)] as OpportunityPartyRole[] });
  }
  if (!participants.length) errors.participants = "Add at least one participating account with a role.";
  const productIds = form.getAll("productId").map(String);
  const quantities = form.getAll("quantity").map(String);
  const prices = form.getAll("price").map(String);
  const lineIds = form.getAll("lineId").map(String);
  const lines: Line[] = [];
  for (let i = 0; i < productIds.length; i++) {
    if (!productIds[i] && !quantities[i] && !prices[i]) continue;
    const productId = positiveId(productIds[i]), quantity = Number(quantities[i]);
    const price = prices[i]; const id = lineIds[i] ? positiveId(lineIds[i]) : undefined;
    if (!productId || !Number.isSafeInteger(quantity) || quantity <= 0 || !/^\d+(\.\d{1,2})?$/.test(price) || Number(price) > 9999999999.99 || (lineIds[i] && !id)) { errors.lines = "Each product needs a valid quantity and nonnegative price with up to two decimals."; continue; }
    lines.push({ id: id ?? undefined, productId, quantity, price });
  }
  if (new Set(lines.map((line) => line.id).filter(Boolean)).size !== lines.filter((line) => line.id).length) errors.lines = "Duplicate line item.";
  return { errors, value: Object.keys(errors).length ? undefined : { name, description, ownerId, stageId: stageId!, expectedCloseDate, probability, forecastCategory, currencyCode, participants, lines } satisfies OpportunityInput };
}
export function lineTotal(line: { quantity: number; estimatedUnitPrice: Prisma.Decimal | string | number }) { return new Prisma.Decimal(line.estimatedUnitPrice).mul(line.quantity); }
export function opportunityTotal(lines: { quantity: number; estimatedUnitPrice: Prisma.Decimal | string | number; archivedAt?: Date | null }[]) { return lines.reduce((sum, line) => line.archivedAt ? sum : sum.add(lineTotal(line)), new Prisma.Decimal(0)); }
export function weightedValue(total: Prisma.Decimal, probability: number) { return total.mul(probability).div(100); }
export async function opportunityOptions(client: PrismaClient) {
  const [accounts, owners, stages, currencies, products] = await Promise.all([
    client.account.findMany({ where: { status: "ACTIVE" }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    client.user.findMany({ where: { active: true, archivedAt: null }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }], select: { id: true, firstName: true, lastName: true } }),
    client.salesStage.findMany({ where: { active: true }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] }),
    client.currency.findMany({ where: { active: true }, orderBy: { code: "asc" } }),
    client.product.findMany({ where: { active: true, archivedAt: null }, orderBy: { name: "asc" }, select: { id: true, sku: true, name: true } }),
  ]);
  return { accounts, owners, stages, currencies, products };
}
export async function saveOpportunity(client: PrismaClient, input: OpportunityInput, id?: number) {
  return client.$transaction(async (tx) => {
    const [stage, currency, owner, accounts, products] = await Promise.all([
      tx.salesStage.findUnique({ where: { id: input.stageId } }), tx.currency.findUnique({ where: { code: input.currencyCode } }),
      input.ownerId ? tx.user.findUnique({ where: { id: input.ownerId } }) : null,
      tx.account.findMany({ where: { id: { in: input.participants.map((p) => p.accountId) }, status: "ACTIVE" }, select: { id: true } }),
      tx.product.findMany({ where: { id: { in: input.lines.map((l) => l.productId) }, active: true, archivedAt: null }, select: { id: true } }),
    ]);
    if (!stage?.active) throw new Error("Choose an available sales stage.");
    if (!currency?.active) throw new Error("Choose an available currency.");
    if (input.ownerId && (!owner?.active || owner.archivedAt)) throw new Error("Choose an active owner.");
    if (accounts.length !== input.participants.length) throw new Error("Choose active accounts for all participants.");
    if (products.length !== new Set(input.lines.map((l) => l.productId)).size) throw new Error("Choose active products for all line items.");
    const data = { name: input.name, description: input.description, ownerId: input.ownerId, stageId: input.stageId, expectedCloseDate: input.expectedCloseDate, probability: input.probability, forecastCategory: input.forecastCategory, currencyCode: input.currencyCode };
    if (id) { const existing = await tx.opportunity.findUnique({ where: { id } }); if (!existing) throw new Error("Opportunity not found."); if (existing.archivedAt) throw new Error("Reactivate this opportunity before editing it."); await tx.opportunity.update({ where: { id }, data }); }
    else { const created = await tx.opportunity.create({ data }); id = created.id; }
    const opportunityId = id;
    const existingMemberships = await tx.opportunityAccount.findMany({ where: { opportunityId }, include: { roles: true } });
    for (const membership of existingMemberships) {
      const desired = input.participants.find((p) => p.accountId === membership.accountId);
      if (!desired) { await tx.opportunityAccountRole.deleteMany({ where: { opportunityId, accountId: membership.accountId } }); await tx.opportunityAccount.delete({ where: { opportunityId_accountId: { opportunityId, accountId: membership.accountId } } }); }
      else { const remove = membership.roles.filter((r) => !desired.roles.includes(r.role)); if (remove.length) await tx.opportunityAccountRole.deleteMany({ where: { opportunityId, accountId: membership.accountId, role: { in: remove.map((r) => r.role) } } }); }
    }
    for (const participant of input.participants) {
      await tx.opportunityAccount.upsert({ where: { opportunityId_accountId: { opportunityId, accountId: participant.accountId } }, create: { opportunityId, accountId: participant.accountId }, update: {} });
      const old = existingMemberships.find((m) => m.accountId === participant.accountId)?.roles.map((r) => r.role) ?? [];
      for (const role of participant.roles.filter((r) => !old.includes(r))) await tx.opportunityAccountRole.create({ data: { opportunityId, accountId: participant.accountId, role } });
    }
    const existingLines = await tx.opportunityProduct.findMany({ where: { opportunityId, archivedAt: null } });
    for (const line of existingLines.filter((line) => !input.lines.some((item) => item.id === line.id))) await tx.opportunityProduct.update({ where: { id: line.id }, data: { archivedAt: new Date() } });
    for (const line of input.lines) {
      if (line.id) { if (!existingLines.some((old) => old.id === line.id)) throw new Error("Line item not found."); await tx.opportunityProduct.update({ where: { id: line.id }, data: { productId: line.productId, quantity: line.quantity, estimatedUnitPrice: line.price } }); }
      else await tx.opportunityProduct.create({ data: { opportunityId, productId: line.productId, quantity: line.quantity, estimatedUnitPrice: line.price } });
    }
    return opportunityId;
  });
}
export async function setOpportunityArchived(client: PrismaClient, id: number, archived: boolean) {
  const row = await client.opportunity.findUnique({ where: { id } }); if (!row) throw new Error("Opportunity not found.");
  if (!!row.archivedAt === archived) throw new Error(archived ? "Opportunity is already archived." : "Opportunity is already active.");
  await client.opportunity.update({ where: { id }, data: { archivedAt: archived ? new Date() : null } });
}
export type OpportunityFilters = { q?: string; stageId?: string; ownerId?: string; forecastCategory?: string; closeFrom?: string; closeTo?: string; accountId?: string; page?: string; archived?: string };
export function opportunityWhere(filters: OpportunityFilters): Prisma.OpportunityWhereInput {
  const where: Prisma.OpportunityWhereInput = { ...archivedWhere(recordVisibility(filters.archived === "yes" ? "archived" : filters.archived === "all" ? "all" : "active")) };
  if (filters.q?.trim()) where.name = { contains: filters.q.trim().slice(0, 100), mode: "insensitive" };
  const stageId = positiveId(filters.stageId ?? ""); if (stageId) where.stageId = stageId;
  const ownerId = positiveId(filters.ownerId ?? ""); if (ownerId) where.ownerId = ownerId;
  const accountId = positiveId(filters.accountId ?? ""); if (accountId) where.participants = { some: { accountId } };
  if (filters.forecastCategory && Object.values(ForecastCategory).includes(filters.forecastCategory as ForecastCategory)) where.forecastCategory = filters.forecastCategory as ForecastCategory;
  const from = filters.closeFrom && /^\d{4}-\d{2}-\d{2}$/.test(filters.closeFrom) ? new Date(`${filters.closeFrom}T00:00:00Z`) : null;
  const to = filters.closeTo && /^\d{4}-\d{2}-\d{2}$/.test(filters.closeTo) ? new Date(`${filters.closeTo}T23:59:59.999Z`) : null;
  if (from && !Number.isNaN(from.getTime()) || to && !Number.isNaN(to.getTime())) where.expectedCloseDate = { ...(from && !Number.isNaN(from.getTime()) ? { gte: from } : {}), ...(to && !Number.isNaN(to.getTime()) ? { lte: to } : {}) };
  return where;
}
export async function listOpportunities(client: PrismaClient, filters: OpportunityFilters) {
  const where = opportunityWhere(filters), count = await client.opportunity.count({ where }); const { page, pages } = pageNumber(filters.page, count);
  const opportunities = await client.opportunity.findMany({ where, include: { stage: true, owner: true, participants: { include: { account: true, roles: true } }, products: { where: { archivedAt: null } } }, orderBy: [{ expectedCloseDate: "asc" }, { id: "desc" }], skip: (page - 1) * 20, take: 20 });
  return { opportunities, count, page, pages };
}
