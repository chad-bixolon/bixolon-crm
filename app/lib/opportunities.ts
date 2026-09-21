import { ForecastCategory, OpportunityPartyRole, OpportunityProductPriceSource, Prisma, ProductPriceTier, type PrismaClient } from "@prisma/client";
import { field, optional, pageNumber, positiveId, required, type Errors } from "./crm-validation";
import { archivedWhere, recordVisibility } from "./record-visibility";
import { moqEligibility, priceExceptionSnapshot } from "./opportunity-price-exceptions";
import type { Actor } from "./authorization";
import { canViewPriceException } from "./price-exception-visibility";
export type Participant = { accountId: number; roles: OpportunityPartyRole[] };
export type Line = { id?: number; productId: number; skuId?: number | null; quantity: number; price: string; priceSource?: OpportunityProductPriceSource; catalogPriceTier?: ProductPriceTier | null; priceExceptionLineId?: number | null };
export type OpportunityInput = { name: string; description: string | null; ownerId: number | null; projectIds: number[]; stageId: number; expectedCloseDate: Date | null; probability: number | null; forecastCategory: ForecastCategory | null; currencyCode: string; participants: Participant[]; lines: Line[] };
export function parseOpportunity(form: FormData) {
  const errors: Errors = {};
  const name = required(form, "name", "Opportunity name", 200, errors);
  const description = optional(form, "description", 5000, errors);
  const ownerRaw = field(form, "ownerId"), ownerId = ownerRaw ? positiveId(ownerRaw) : null;
  if (ownerRaw && !ownerId) errors.ownerId = "Choose a valid owner.";
  const projectRaw = form.getAll("projectIds").map(String), projectIds = projectRaw.map(positiveId);
  if (projectIds.some(id => !id) || new Set(projectIds).size !== projectIds.length) errors.projectIds = "Choose each valid Project only once.";
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
  const skuIds = form.getAll("skuId").map(String);
  const quantities = form.getAll("quantity").map(String);
  const prices = form.getAll("price").map(String);
  const priceSources = form.getAll("priceSource").map(String);
  const catalogPriceTiers = form.getAll("catalogPriceTier").map(String);
  const priceExceptionLineIds = form.getAll("priceExceptionLineId").map(String);
  const lineIds = form.getAll("lineId").map(String);
  const lines: Line[] = [];
  for (let i = 0; i < productIds.length; i++) {
    if (!productIds[i] && !quantities[i] && !prices[i]) continue;
    const productId = positiveId(productIds[i]), skuId = skuIds[i] ? positiveId(skuIds[i]) : null, quantity = Number(quantities[i]);
    const price = prices[i]; const id = lineIds[i] ? positiveId(lineIds[i]) : undefined;
    const rawPriceSource = priceSources[i] || "MANUAL";
    const priceSource = Object.values(OpportunityProductPriceSource).includes(rawPriceSource as OpportunityProductPriceSource) ? rawPriceSource as OpportunityProductPriceSource : null;
    const catalogPriceTier = catalogPriceTiers[i] && Object.values(ProductPriceTier).includes(catalogPriceTiers[i] as ProductPriceTier) ? catalogPriceTiers[i] as ProductPriceTier : null;
    const priceExceptionLineId = priceExceptionLineIds[i] ? positiveId(priceExceptionLineIds[i]) : null;
    const provenanceValid = priceSource === "MANUAL" ? !catalogPriceTier && !priceExceptionLineId : priceSource === "CATALOG" ? !!catalogPriceTier && !priceExceptionLineId : priceSource === "PRICE_EXCEPTION" ? !catalogPriceTier && !!priceExceptionLineId : false;
    if (!productId || (skuIds[i] && !skuId) || !Number.isSafeInteger(quantity) || quantity <= 0 || !/^\d+(\.\d{1,2})?$/.test(price) || Number(price) > 9999999999.99 || (lineIds[i] && !id) || !provenanceValid) { errors.lines = "Each product needs a valid quantity, price, and pricing source."; continue; }
    lines.push({ id: id ?? undefined, productId, ...(skuId ? { skuId } : {}), quantity, price, ...(priceSources[i] ? { priceSource: priceSource!, catalogPriceTier, priceExceptionLineId: priceExceptionLineId ?? null } : {}) });
  }
  if (new Set(lines.map((line) => line.id).filter(Boolean)).size !== lines.filter((line) => line.id).length) errors.lines = "Duplicate line item.";
  return { errors, value: Object.keys(errors).length ? undefined : { name, description, ownerId, projectIds: projectIds as number[], stageId: stageId!, expectedCloseDate, probability, forecastCategory, currencyCode, participants, lines } satisfies OpportunityInput };
}
export function lineTotal(line: { quantity: number; estimatedUnitPrice: Prisma.Decimal | string | number }) { return new Prisma.Decimal(line.estimatedUnitPrice).mul(line.quantity); }
export function opportunityTotal(lines: { quantity: number; estimatedUnitPrice: Prisma.Decimal | string | number; archivedAt?: Date | null }[]) { return lines.reduce((sum, line) => line.archivedAt ? sum : sum.add(lineTotal(line)), new Prisma.Decimal(0)); }
export function weightedValue(total: Prisma.Decimal, probability: number) { return total.mul(probability).div(100); }
export async function opportunityOptions(client: PrismaClient) {
  const [accounts, owners, stages, currencies, productCount, projects, productCategories] = await Promise.all([
    client.account.findMany({ where: { status: "ACTIVE" }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    client.user.findMany({ where: { active: true, archivedAt: null }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }], select: { id: true, firstName: true, lastName: true } }),
    client.salesStage.findMany({ where: { active: true }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] }),
    client.currency.findMany({ where: { active: true }, orderBy: { code: "asc" } }),
    client.product.count({ where: { active: true, archivedAt: null } }),
    client.project.findMany({ where: { archivedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    client.productCategory.findMany({ where: { OR: [{ active: true }, { products: { some: {} } }] }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true } }),
  ]);
  return { accounts, owners, stages, currencies, productCount, projects, productCategories };
}
export async function saveOpportunity(client: PrismaClient, input: OpportunityInput, id?: number, actor?: Actor) {
  input = { ...input, lines: input.lines.map(line => ({ ...line, priceSource: line.priceSource ?? "MANUAL", catalogPriceTier: line.catalogPriceTier ?? null, priceExceptionLineId: line.priceExceptionLineId ?? null })) };
  return client.$transaction(async (tx) => {
    const existing = id ? await tx.opportunity.findUnique({ where: { id }, include: { projects: true } }) : null;
    if (id && (!existing || existing.archivedAt)) throw new Error('Opportunity not found or archived.');
    const existingLines = id ? await tx.opportunityProduct.findMany({ where: { opportunityId: id, archivedAt: null } }) : [];
    const [stage, currency, owner, accounts, products, projects, skus, catalogPrices, peLines] = await Promise.all([
      tx.salesStage.findUnique({ where: { id: input.stageId } }), tx.currency.findUnique({ where: { code: input.currencyCode } }),
      input.ownerId ? tx.user.findUnique({ where: { id: input.ownerId } }) : null,
      tx.account.findMany({ where: { id: { in: input.participants.map((p) => p.accountId) }, status: "ACTIVE" }, select: { id: true } }),
      tx.product.findMany({ where: { id: { in: input.lines.map((l) => l.productId) }, active: true, archivedAt: null }, select: { id: true } }),
      tx.project.findMany({ where: { id: { in: input.projectIds } }, select: { id: true, archivedAt: true } }),
      input.lines.some(line => line.skuId) ? tx.productSku.findMany({ where: { id: { in: input.lines.flatMap(line => line.skuId ? [line.skuId] : []) } }, select: { id: true, productId: true, active: true } }) : Promise.resolve([]),
      input.lines.some(line => line.priceSource === "CATALOG") ? tx.productPrice.findMany({ where: { OR: input.lines.filter(line => line.priceSource === "CATALOG" && line.skuId && line.catalogPriceTier).map(line => ({ skuId: line.skuId!, currencyCode: input.currencyCode, tier: line.catalogPriceTier! })) }, select: { skuId: true, currencyCode: true, tier: true } }) : Promise.resolve([]),
      input.lines.some(line => line.priceSource === "PRICE_EXCEPTION") ? tx.priceExceptionLine.findMany({ where: { id: { in: input.lines.flatMap(line => line.priceExceptionLineId ? [line.priceExceptionLineId] : []) } }, include: { priceException: true } }) : Promise.resolve([]),
    ]);
    if (!stage || (!stage.active && existing?.stageId !== input.stageId)) throw new Error("Choose an available sales stage.");
    if (!currency?.active) throw new Error("Choose an available currency.");
    if (input.ownerId && (!owner?.active || owner.archivedAt)) throw new Error("Choose an active owner.");
    if (new Set(input.projectIds).size !== input.projectIds.length || projects.length !== input.projectIds.length || projects.some(project => project.archivedAt && !existing?.projects.some(link => link.projectId === project.id))) throw new Error("Choose each active Project only once.");
    if (accounts.length !== input.participants.length) throw new Error("Choose active accounts for all participants.");
    if (products.length !== new Set(input.lines.map((l) => l.productId)).size) throw new Error("Choose active products for all line items.");
    for (const line of input.lines) if (line.skuId && !skus.some(sku => sku.id === line.skuId && sku.productId === line.productId && (sku.active || existingLines.some(old => old.id === line.id && old.productId === line.productId && old.skuId === line.skuId)))) throw new Error("Choose an active SKU belonging to the selected product.");
    for (const line of input.lines) {
      if (line.priceSource === "CATALOG" && (!line.skuId || !catalogPrices.some(price => price.skuId === line.skuId && price.currencyCode === input.currencyCode && price.tier === line.catalogPriceTier))) throw new Error("Choose an available catalog price for the Opportunity currency.");
      if (line.priceSource === "PRICE_EXCEPTION") {
        if (!line.skuId) throw new Error("Price Exception pricing requires a resolved SKU.");
        const selected = peLines.find(candidate => candidate.id === line.priceExceptionLineId);
        const old = existingLines.find(candidate => candidate.id === line.id);
        const retainingHistoricalSelection = !!selected && old?.priceSource === "PRICE_EXCEPTION" && old.priceExceptionLineId === selected.id && old.skuId === line.skuId && old.priceExceptionCurrencyCode === input.currencyCode;
        const cutoff = new Date(); cutoff.setUTCHours(0, 0, 0, 0);
        if (!retainingHistoricalSelection && (!selected || selected.productSkuId !== line.skuId || !selected.approvedUnitPrice || selected.currencyCode !== input.currencyCode)) throw new Error("Choose a Price Exception line for this SKU and Opportunity currency.");
        if (!retainingHistoricalSelection && (!actor || !canViewPriceException(actor, selected!.priceException))) throw new Error("That Price Exception is not available to this user.");
        if (!retainingHistoricalSelection && (selected!.priceException.status !== "ACTIVE" || selected!.priceException.archivedAt || (selected!.priceException.expirationDate && selected!.priceException.expirationDate < cutoff))) throw new Error("That Price Exception is no longer available for new selection.");
        const eligibility = moqEligibility(line.quantity, retainingHistoricalSelection ? old.priceExceptionSourceQty : selected!.sourceQuantity?.toString() ?? null);
        const pricingChanged = !old || old.quantity !== line.quantity || !old.estimatedUnitPrice.equals(line.price) || !retainingHistoricalSelection;
        if (eligibility === "UNKNOWN" && pricingChanged) throw new Error("This Price Exception has no resolved numeric MOQ and cannot be applied directly.");
        if (eligibility === "INELIGIBLE" && pricingChanged) throw new Error("Opportunity quantity does not meet the selected Price Exception MOQ.");
      }
    }
    const data = { name: input.name, description: input.description, ownerId: input.ownerId, stageId: input.stageId, expectedCloseDate: input.expectedCloseDate, probability: input.probability, forecastCategory: input.forecastCategory, currencyCode: input.currencyCode };
    if (id) { await tx.opportunity.update({ where: { id }, data }); }
    else { const created = await tx.opportunity.create({ data }); id = created.id; }
    const opportunityId = id;
    for (const link of existing?.projects ?? []) if (!input.projectIds.includes(link.projectId)) await tx.opportunityProject.delete({ where: { opportunityId_projectId: { opportunityId, projectId: link.projectId } } });
    for (const projectId of input.projectIds) if (!existing?.projects.some(link => link.projectId === projectId)) await tx.opportunityProject.create({ data: { opportunityId, projectId } });
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
    for (const line of existingLines.filter((line) => !input.lines.some((item) => item.id === line.id))) await tx.opportunityProduct.update({ where: { id: line.id }, data: { archivedAt: new Date() } });
    for (const line of input.lines) {
      const old = existingLines.find(candidate => candidate.id === line.id);
      const selectedPe = line.priceSource === "PRICE_EXCEPTION" ? peLines.find(candidate => candidate.id === line.priceExceptionLineId)! : null;
      const retainSnapshot = !!old && old.priceSource === "PRICE_EXCEPTION" && old.priceExceptionLineId === line.priceExceptionLineId;
      const provenance = line.priceSource === "PRICE_EXCEPTION" ? (retainSnapshot ? {
        priceSource: line.priceSource, catalogPriceTier: null, priceExceptionLineId: old.priceExceptionLineId, priceExceptionCode: old.priceExceptionCode, priceExceptionUnitPrice: old.priceExceptionUnitPrice, priceExceptionCurrencyCode: old.priceExceptionCurrencyCode, priceExceptionSourceQty: old.priceExceptionSourceQty,
      } : {
        priceSource: line.priceSource, catalogPriceTier: null, ...priceExceptionSnapshot(selectedPe!),
      }) : { priceSource: line.priceSource, catalogPriceTier: line.priceSource === "CATALOG" ? line.catalogPriceTier : null, priceExceptionLineId: null, priceExceptionCode: null, priceExceptionUnitPrice: null, priceExceptionCurrencyCode: null, priceExceptionSourceQty: null };
      const lineData = { productId: line.productId, skuId: line.skuId ?? null, quantity: line.quantity, estimatedUnitPrice: line.price, ...provenance };
      if (line.id) { if (!old) throw new Error("Line item not found."); await tx.opportunityProduct.update({ where: { id: line.id }, data: lineData }); }
      else await tx.opportunityProduct.create({ data: { opportunityId, ...lineData } });
    }
    return opportunityId;
  });
}
export async function setOpportunityArchived(client: PrismaClient, id: number, archived: boolean) {
  const row = await client.opportunity.findUnique({ where: { id } }); if (!row) throw new Error("Opportunity not found.");
  if (!!row.archivedAt === archived) throw new Error(archived ? "Opportunity is already archived." : "Opportunity is already active.");
  await client.opportunity.update({ where: { id }, data: { archivedAt: archived ? new Date() : null } });
}
export type OpportunityFilters = { q?: string; stageId?: string; ownerId?: string; projectId?: string; forecastCategory?: string; closeFrom?: string; closeTo?: string; accountId?: string; page?: string; archived?: string };
export function opportunityWhere(filters: OpportunityFilters): Prisma.OpportunityWhereInput {
  const where: Prisma.OpportunityWhereInput = { ...archivedWhere(recordVisibility(filters.archived === "yes" ? "archived" : filters.archived === "all" ? "all" : "active")) };
  if (filters.q?.trim()) where.name = { contains: filters.q.trim().slice(0, 100), mode: "insensitive" };
  const stageId = positiveId(filters.stageId ?? ""); if (stageId) where.stageId = stageId;
  const ownerId = positiveId(filters.ownerId ?? ""); if (ownerId) where.ownerId = ownerId;
  const accountId = positiveId(filters.accountId ?? ""); if (accountId) where.participants = { some: { accountId } };
  if (filters.projectId === 'none') where.projects = { none: {} };
  else { const projectId = positiveId(filters.projectId ?? ''); if (projectId) where.projects = { some: { projectId } }; }
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
