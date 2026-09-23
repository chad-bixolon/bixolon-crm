import { ForecastCategory, OpportunityPartyRole, OpportunityProductPriceSource, Prisma, ProductPriceTier, type PrismaClient } from "@prisma/client";
import { field, optional, pageNumber, positiveId, required, type Errors } from "./crm-validation";
import { archivedWhere, recordVisibility } from "./record-visibility";
import { moqEligibility, priceExceptionSnapshot } from "./opportunity-price-exceptions";
import type { Actor } from "./authorization";
import { canViewPriceException } from "./price-exception-visibility";
import { odmCustomerSnapshot } from './opportunity-odm-pricing';
export type Participant = { accountId: number; roles: OpportunityPartyRole[] };
export type OpportunityContactInput = { contactId: number; isPrimary: boolean };
export type Line = { id?: number; productId: number; skuId?: number | null; quantity: number; price: string; priceSource?: OpportunityProductPriceSource; catalogPriceTier?: ProductPriceTier | null; priceExceptionLineId?: number | null; odmCustomerPriceId?: number | null; odmCustomerAccountId?: number | null };
export type OpportunityInput = { name: string; description: string | null; competitorId?: number | null; currentProductBeingUsed?: string | null; customerPainPoints?: string | null; ownerId: number | null; projectIds: number[]; stageId: number; expectedCloseDate: Date | null; probability: number | null; forecastCategory: ForecastCategory | null; currencyCode: string; participants: Participant[]; contacts: OpportunityContactInput[]; lines: Line[] };
export function categoryForStage(stage: { isClosed: boolean; isWon: boolean }, requested: ForecastCategory | null, previous?: { stageId: number; forecastCategory: ForecastCategory } | null, stageId?: number): ForecastCategory {
  if (stage.isClosed) return stage.isWon ? ForecastCategory.CLOSED : ForecastCategory.OMITTED;
  if (requested === ForecastCategory.CLOSED) {
    if (previous?.forecastCategory === ForecastCategory.CLOSED && previous.stageId !== stageId) return ForecastCategory.PIPELINE;
    throw new Error('Open Opportunities cannot have the Closed forecast category.');
  }
  return requested ?? ForecastCategory.PIPELINE;
}
export function parseOpportunity(form: FormData) {
  const errors: Errors = {};
  const name = required(form, "name", "Opportunity name", 200, errors);
  const description = optional(form, "description", 5000, errors);
  const competitorRaw = field(form, "competitorId"), competitorId = competitorRaw ? positiveId(competitorRaw) : null;
  if (competitorRaw && !competitorId) errors.competitorId = "Choose a valid competitor.";
  const currentProductBeingUsed = optional(form, "currentProductBeingUsed", 500, errors);
  const customerPainPoints = optional(form, "customerPainPoints", 20000, errors);
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
  const contactIds = form.getAll("contactId").map(String);
  const primaryContactId = field(form, "primaryContactId");
  const contacts: OpportunityContactInput[] = [];
  for (const raw of contactIds) {
    const contactId = positiveId(raw);
    if (!contactId || contacts.some(contact => contact.contactId === contactId)) { errors.contacts = "Choose each valid Contact only once."; continue; }
    contacts.push({ contactId, isPrimary: raw === primaryContactId });
  }
  if (primaryContactId && !contacts.some(contact => String(contact.contactId) === primaryContactId)) errors.contacts = "Primary Contact must be one of the selected Contacts.";
  const productIds = form.getAll("productId").map(String);
  const skuIds = form.getAll("skuId").map(String);
  const quantities = form.getAll("quantity").map(String);
  const prices = form.getAll("price").map(String);
  const priceSources = form.getAll("priceSource").map(String);
  const catalogPriceTiers = form.getAll("catalogPriceTier").map(String);
  const priceExceptionLineIds = form.getAll("priceExceptionLineId").map(String);
  const odmCustomerPriceIds = form.getAll("odmCustomerPriceId").map(String);
  const odmCustomerAccountIds = form.getAll("odmCustomerAccountId").map(String);
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
    const odmCustomerPriceId = odmCustomerPriceIds[i] ? positiveId(odmCustomerPriceIds[i]) : null;
    const odmCustomerAccountId = odmCustomerAccountIds[i] ? positiveId(odmCustomerAccountIds[i]) : null;
    const provenanceValid = priceSource === "MANUAL" ? !catalogPriceTier && !priceExceptionLineId && !odmCustomerPriceId && !odmCustomerAccountId : priceSource === "CATALOG" ? !!catalogPriceTier && !priceExceptionLineId && !odmCustomerPriceId && !odmCustomerAccountId : priceSource === "PRICE_EXCEPTION" ? !catalogPriceTier && !!priceExceptionLineId && !odmCustomerPriceId && !odmCustomerAccountId : priceSource === "ODM_CUSTOMER" ? !catalogPriceTier && !priceExceptionLineId && !!odmCustomerPriceId && !!odmCustomerAccountId : false;
    if (!productId || (skuIds[i] && !skuId) || !Number.isSafeInteger(quantity) || quantity <= 0 || !/^\d+(\.\d{1,2})?$/.test(price) || Number(price) > 9999999999.99 || (lineIds[i] && !id) || !provenanceValid) { errors.lines = "Each product needs a valid quantity, price, and pricing source."; continue; }
    lines.push({ id: id ?? undefined, productId, ...(skuId ? { skuId } : {}), quantity, price, ...(priceSources[i] ? { priceSource: priceSource!, catalogPriceTier, priceExceptionLineId: priceExceptionLineId ?? null, odmCustomerPriceId, odmCustomerAccountId } : {}) });
  }
  if (new Set(lines.map((line) => line.id).filter(Boolean)).size !== lines.filter((line) => line.id).length) errors.lines = "Duplicate line item.";
  return { errors, value: Object.keys(errors).length ? undefined : { name, description, competitorId, currentProductBeingUsed, customerPainPoints, ownerId, projectIds: projectIds as number[], stageId: stageId!, expectedCloseDate, probability, forecastCategory, currencyCode, participants, contacts, lines } satisfies OpportunityInput };
}
export function lineTotal(line: { quantity: number; estimatedUnitPrice: Prisma.Decimal | string | number }) { return new Prisma.Decimal(line.estimatedUnitPrice).mul(line.quantity); }
export function opportunityTotal(lines: { quantity: number; estimatedUnitPrice: Prisma.Decimal | string | number; archivedAt?: Date | null }[]) { return lines.reduce((sum, line) => line.archivedAt ? sum : sum.add(lineTotal(line)), new Prisma.Decimal(0)); }
export function weightedValue(total: Prisma.Decimal, probability: number) { return total.mul(probability).div(100); }
export async function opportunityOptions(client: PrismaClient) {
  const [accounts, contacts, owners, stages, currencies, productCount, projects, productCategories, competitors] = await Promise.all([
    client.account.findMany({ where: { status: "ACTIVE" }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    client.contact ? client.contact.findMany({ where: { active: true, archivedAt: null }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }], select: { id: true, firstName: true, lastName: true, email: true, accountId: true } }) : Promise.resolve([]),
    client.user.findMany({ where: { active: true, archivedAt: null }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }], select: { id: true, firstName: true, lastName: true } }),
    client.salesStage.findMany({ where: { active: true }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }], select: { id: true, name: true, probability: true, isClosed: true, isWon: true } }),
    client.currency.findMany({ where: { active: true }, orderBy: { code: "asc" }, select: { code: true, name: true } }),
    client.product.count({ where: { active: true, archivedAt: null } }),
    client.project.findMany({ where: { archivedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    client.productCategory.findMany({ where: { OR: [{ active: true }, { products: { some: {} } }] }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true } }),
    client.competitorOption.findMany({ where: { active: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true, active: true } }),
  ]);
  return { accounts, contacts, owners, stages, currencies, productCount, projects, productCategories, competitors };
}
export async function saveOpportunity(client: PrismaClient, input: OpportunityInput, id?: number, actor?: Actor) {
  input = { ...input, contacts: input.contacts ?? [], lines: input.lines.map(line => ({ ...line, priceSource: line.priceSource ?? "MANUAL", catalogPriceTier: line.catalogPriceTier ?? null, priceExceptionLineId: line.priceExceptionLineId ?? null, odmCustomerPriceId: line.odmCustomerPriceId ?? null, odmCustomerAccountId: line.odmCustomerAccountId ?? null })) };
  const run = async (tx: Prisma.TransactionClient) => {
    const existing = id ? await tx.opportunity.findUnique({ where: { id }, include: { projects: true } }) : null;
    if (id && (!existing || existing.archivedAt)) throw new Error('Opportunity not found or archived.');
    const existingLines = id ? await tx.opportunityProduct.findMany({ where: { opportunityId: id, archivedAt: null } }) : [];
    const [stage, currency, owner, accounts, contacts, products, projects, skus, catalogPrices, peLines, odmPrices] = await Promise.all([
      tx.salesStage.findUnique({ where: { id: input.stageId } }), tx.currency.findUnique({ where: { code: input.currencyCode } }),
      input.ownerId ? tx.user.findUnique({ where: { id: input.ownerId } }) : null,
      tx.account.findMany({ where: { id: { in: input.participants.map((p) => p.accountId) }, status: "ACTIVE" }, select: { id: true } }),
      input.contacts.length ? tx.contact.findMany({ where: { id: { in: input.contacts.map(contact => contact.contactId) }, active: true, archivedAt: null }, select: { id: true, accountId: true } }) : Promise.resolve([]),
      tx.product.findMany({ where: { id: { in: input.lines.map((l) => l.productId) }, active: true, archivedAt: null }, select: { id: true } }),
      tx.project.findMany({ where: { id: { in: input.projectIds } }, select: { id: true, archivedAt: true } }),
      input.lines.some(line => line.skuId) ? tx.productSku.findMany({ where: { id: { in: input.lines.flatMap(line => line.skuId ? [line.skuId] : []) } }, select: { id: true, productId: true, active: true, catalogSource: true, odmSubtype: true } }) : Promise.resolve([]),
      input.lines.some(line => line.priceSource === "CATALOG") ? tx.productPrice.findMany({ where: { OR: input.lines.filter(line => line.priceSource === "CATALOG" && line.skuId && line.catalogPriceTier).map(line => ({ skuId: line.skuId!, currencyCode: input.currencyCode, tier: line.catalogPriceTier! })) }, select: { skuId: true, currencyCode: true, tier: true } }) : Promise.resolve([]),
      input.lines.some(line => line.priceSource === "PRICE_EXCEPTION") ? tx.priceExceptionLine.findMany({ where: { id: { in: input.lines.flatMap(line => line.priceExceptionLineId ? [line.priceExceptionLineId] : []) } }, include: { priceException: true } }) : Promise.resolve([]),
      input.lines.some(line => line.priceSource === "ODM_CUSTOMER") ? tx.productSkuOdmCustomerPrice.findMany({ where: { id: { in: input.lines.flatMap(line => line.odmCustomerPriceId ? [line.odmCustomerPriceId] : []) } }, include: { odmCustomer: { include: { sku: true } } } }) : Promise.resolve([]),
    ]);
    if (!stage || (!stage.active && existing?.stageId !== input.stageId)) throw new Error("Choose an available sales stage.");
    if (input.competitorId) {
      const competitor = await tx.competitorOption.findUnique({ where: { id: input.competitorId } });
      if (!competitor || (!competitor.active && existing?.competitorId !== input.competitorId)) throw new Error("Choose an available competitor.");
    }
    if (actor?.role === 'SALES' && (input.ownerId !== actor.id || (existing && existing.ownerId !== actor.id))) throw new Error('Sales users may edit only their own Opportunities.');
    if (!currency?.active) throw new Error("Choose an available currency.");
    if (input.ownerId && (!owner?.active || owner.archivedAt)) throw new Error("Choose an active owner.");
    if (new Set(input.projectIds).size !== input.projectIds.length || projects.length !== input.projectIds.length || projects.some(project => project.archivedAt && !existing?.projects.some(link => link.projectId === project.id))) throw new Error("Choose each active Project only once.");
    if (accounts.length !== input.participants.length) throw new Error("Choose active accounts for all participants.");
    if (contacts.length !== input.contacts.length) throw new Error("Choose active Contacts.");
    const participantIds = new Set(input.participants.map(participant => participant.accountId));
    if (contacts.some(contact => contact.accountId && !participantIds.has(contact.accountId))) throw new Error("Each selected Contact must belong to a participating Account, or be unassigned.");
    if (input.contacts.filter(contact => contact.isPrimary).length > 1) throw new Error("Choose at most one Primary Contact.");
    if (products.length !== new Set(input.lines.map((l) => l.productId)).size) throw new Error("Choose active products for all line items.");
    for (const line of input.lines) if (line.skuId && !skus.some(sku => sku.id === line.skuId && sku.productId === line.productId && (sku.active || existingLines.some(old => old.id === line.id && old.productId === line.productId && old.skuId === line.skuId)))) throw new Error("Choose an active SKU belonging to the selected product.");
    for (const line of input.lines) {
      if (line.priceSource === 'ODM_CUSTOMER') {
        const selected = odmPrices.find(candidate => candidate.id === line.odmCustomerPriceId);
        const old = existingLines.find(candidate => candidate.id === line.id);
        const retaining = !!old && old.priceSource === 'ODM_CUSTOMER' && old.odmCustomerPriceId === line.odmCustomerPriceId && old.odmCustomerAccountId === line.odmCustomerAccountId && old.skuId === line.skuId && old.odmCustomerCurrencyCode === input.currencyCode;
        if (!selected || selected.skuId !== line.skuId || selected.accountId !== line.odmCustomerAccountId || selected.currencyCode !== input.currencyCode || selected.odmCustomer.sku.catalogSource !== 'ODM' || selected.odmCustomer.sku.odmSubtype !== 'CUSTOMER_SPECIFIC') throw new Error('Choose a valid ODM customer price for this SKU and currency.');
        if (!retaining && (selected.archivedAt || selected.odmCustomer.archivedAt || !input.participants.some(participant => participant.accountId === selected.accountId))) throw new Error('The selected ODM customer price is not active for a participating Account.');
        const expected = retaining ? old.odmCustomerFinalUnitPrice : selected.finalUnitPrice;
        if (!expected || !expected.equals(line.price)) throw new Error('ODM Opportunity Unit Price must equal the selected final price. Choose Manual for a different price.');
      }
      if (line.priceSource === "CATALOG" && (!line.skuId || skus.some(sku => sku.id === line.skuId && sku.catalogSource === 'ODM' && sku.odmSubtype === 'CUSTOMER_SPECIFIC') || !catalogPrices.some(price => price.skuId === line.skuId && price.currencyCode === input.currencyCode && price.tier === line.catalogPriceTier))) throw new Error("Choose an available catalog price for the Opportunity currency.");
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
    const data = { name: input.name, description: input.description, competitorId: input.competitorId ?? null, currentProductBeingUsed: input.currentProductBeingUsed ?? null, customerPainPoints: input.customerPainPoints ?? null, ownerId: input.ownerId, stageId: input.stageId, expectedCloseDate: input.expectedCloseDate, probability: input.probability, forecastCategory: categoryForStage(stage, input.forecastCategory, existing, input.stageId), currencyCode: input.currencyCode };
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
    if (tx.opportunityContact) {
      const existingContacts = await tx.opportunityContact.findMany({ where: { opportunityId } });
      for (const link of existingContacts.filter(link => !input.contacts.some(contact => contact.contactId === link.contactId))) await tx.opportunityContact.delete({ where: { opportunityId_contactId: { opportunityId, contactId: link.contactId } } });
      // Clear first so switching primaries cannot transiently violate the partial unique index.
      await tx.opportunityContact.updateMany({ where: { opportunityId, isPrimary: true }, data: { isPrimary: false } });
      for (const contact of input.contacts) await tx.opportunityContact.upsert({ where: { opportunityId_contactId: { opportunityId, contactId: contact.contactId } }, create: { opportunityId, ...contact }, update: { isPrimary: contact.isPrimary } });
    }
    for (const line of existingLines.filter((line) => !input.lines.some((item) => item.id === line.id))) await tx.opportunityProduct.update({ where: { id: line.id }, data: { archivedAt: new Date() } });
    for (const line of input.lines) {
      const old = existingLines.find(candidate => candidate.id === line.id);
      const selectedPe = line.priceSource === "PRICE_EXCEPTION" ? peLines.find(candidate => candidate.id === line.priceExceptionLineId)! : null;
      const retainSnapshot = !!old && old.priceSource === "PRICE_EXCEPTION" && old.priceExceptionLineId === line.priceExceptionLineId;
      const selectedOdm = line.priceSource === 'ODM_CUSTOMER' ? odmPrices.find(candidate => candidate.id === line.odmCustomerPriceId)! : null;
      const retainOdm = !!old && old.priceSource === 'ODM_CUSTOMER' && old.odmCustomerPriceId === line.odmCustomerPriceId && old.odmCustomerAccountId === line.odmCustomerAccountId;
      const provenance = line.priceSource === "PRICE_EXCEPTION" ? (retainSnapshot ? {
        priceSource: line.priceSource, catalogPriceTier: null, priceExceptionLineId: old.priceExceptionLineId, priceExceptionCode: old.priceExceptionCode, priceExceptionUnitPrice: old.priceExceptionUnitPrice, priceExceptionCurrencyCode: old.priceExceptionCurrencyCode, priceExceptionSourceQty: old.priceExceptionSourceQty,
      } : {
        priceSource: line.priceSource, catalogPriceTier: null, ...priceExceptionSnapshot(selectedPe!),
      }) : { priceSource: line.priceSource, catalogPriceTier: line.priceSource === "CATALOG" ? line.catalogPriceTier : null, priceExceptionLineId: null, priceExceptionCode: null, priceExceptionUnitPrice: null, priceExceptionCurrencyCode: null, priceExceptionSourceQty: null };
      const odmSnapshot = odmCustomerSnapshot(selectedOdm, retainOdm ? old : null);
      const lineData = { productId: line.productId, skuId: line.skuId ?? null, quantity: line.quantity, estimatedUnitPrice: line.price, ...provenance, ...odmSnapshot };
      if (line.id) { if (!old) throw new Error("Line item not found."); await tx.opportunityProduct.update({ where: { id: line.id }, data: lineData }); }
      else await tx.opportunityProduct.create({ data: { opportunityId, ...lineData } });
    }
    return opportunityId;
  };
  // Transaction clients intentionally omit $transaction. This permits conversion to
  // compose the normal Opportunity save inside its larger atomic transaction.
  if ('$transaction' in client && typeof client.$transaction === 'function') return client.$transaction(run);
  return run(client as unknown as Prisma.TransactionClient);
}
export async function setOpportunityArchived(client: PrismaClient, id: number, archived: boolean, actor?: Actor) {
  const row = await client.opportunity.findUnique({ where: { id } }); if (!row) throw new Error("Opportunity not found.");
  if (actor?.role === 'SALES' && row.ownerId !== actor.id) throw new Error('Sales users may edit only their own Opportunities.');
  if (!!row.archivedAt === archived) throw new Error(archived ? "Opportunity is already archived." : "Opportunity is already active.");
  await client.opportunity.update({ where: { id }, data: { archivedAt: archived ? new Date() : null } });
}
export type OpportunityFilters = { q?: string; stageId?: string; ownerId?: string; competitorId?: string; projectId?: string; forecastCategory?: string; closeFrom?: string; closeTo?: string; accountId?: string; page?: string; archived?: string };
export function opportunityWhere(filters: OpportunityFilters): Prisma.OpportunityWhereInput {
  const where: Prisma.OpportunityWhereInput = { ...archivedWhere(recordVisibility(filters.archived === "yes" ? "archived" : filters.archived === "all" ? "all" : "active")) };
  if (filters.q?.trim()) where.name = { contains: filters.q.trim().slice(0, 100), mode: "insensitive" };
  const stageId = positiveId(filters.stageId ?? ""); if (stageId) where.stageId = stageId;
  const competitorId = positiveId(filters.competitorId ?? ""); if (competitorId) where.competitorId = competitorId;
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
