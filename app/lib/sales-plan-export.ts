import * as XLSX from 'xlsx';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { ForecastCategory, Prisma, type PrismaClient } from '@prisma/client';
import { can, opportunityScope, type Actor } from './authorization';
import { activeSalesRepWhere } from './assignment-eligibility';
import { annualTargetFromRows, allocationSummary } from './sales-plan';
import { salesPlanPopulation } from './sales-plan-queries';
import { forecastForTeam, quarters } from './forecast';
import { operationalOpportunityWhere } from './operational-where';
import { lineTotal, opportunityTotal } from './opportunities';
import { salesPlanManagementWorkbook } from './sales-plan-export-workbook';

const zero = new Prisma.Decimal(0);
const sum = (values: (Prisma.Decimal | null | undefined)[]) => values.reduce<Prisma.Decimal>((total, value) => total.add(value ?? zero), zero);
const amount = (value: Prisma.Decimal | string | null | undefined) => value === null || value === undefined ? null : Number(value);
const repName = (user: { firstName: string; lastName: string }) => `${user.firstName} ${user.lastName}`;
const key = (rep: number, account: number, sku: number) => `${rep}:${account}:${sku}`;
export function exportAccess(actor: Actor) { return can(actor, 'sales-plan.manage') && (actor.role === 'ADMIN' || actor.role === 'SALES_MANAGER'); }
export function exportSelection(raw: { year?: string | null; currencyCode?: string | null; userId?: string | null }) {
  const year = Number(raw.year), userId = raw.userId ? Number(raw.userId) : null, currencyCode = raw.currencyCode ?? '';
  if (!Number.isInteger(year) || year < 2000 || year > 2100 || !/^[A-Z]{3}$/.test(currencyCode) || (userId !== null && (!Number.isSafeInteger(userId) || userId <= 0))) throw new Error('Choose a valid year, currency, and sales rep.');
  return { year, currencyCode, userId };
}
export function exportFilename(year: number, currencyCode: string, rep?: string) {
  const suffix = rep ? `_${rep.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 70)}` : '';
  return `SalesHub_Sales_Plan_Status_${year}${suffix}_${currencyCode}.xlsx`;
}

export async function buildSalesPlanManagementExport(client: PrismaClient, actor: Actor & { name?: string }, selection: { year: number; currencyCode: string; userId: number | null }, generatedAt = new Date()) {
  if (!exportAccess(actor)) throw new Error('Access denied');
  const { year, currencyCode, userId } = exportSelection({ year: String(selection.year), currencyCode: selection.currencyCode, userId: selection.userId === null ? null : String(selection.userId) });
  const [users, plans] = await Promise.all([
    client.user.findMany({ where: activeSalesRepWhere(), select: { id: true, firstName: true, lastName: true, role: true, active: true, archivedAt: true }, orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }] }),
    client.salesPlan.findMany({ where: { planYear: year, currencyCode, status: 'ACTIVE', owner: activeSalesRepWhere(), ...(userId ? { ownerId: userId } : {}) }, select: { id: true, ownerId: true, revision: true, lines: { select: { id: true, accountId: true, originalAccountText: true, account: { select: { name: true } }, productSkuId: true, originalSkuText: true, productSku: { select: { partNumber: true, product: { select: { name: true } } } }, planItem: true, annualPlannedUnits: true, annualPlannedRevenue: true, priorYearRevenue: true, comments: true, allocations: { select: { quarter: true, plannedUnits: true, plannedRevenue: true } } }, orderBy: [{ sourceWorksheet: 'asc' }, { sourceRow: 'asc' }, { id: 'asc' }] } } }),
  ]);
  const population = salesPlanPopulation(users.map(u => u.id), plans.map(p => p.ownerId), userId);
  const selectedUsers = users.filter(u => population.ownerIds.includes(u.id));
  const ownerIds = selectedUsers.map(u => u.id);
  const [targetRows, forecastQuarters, opportunities] = await Promise.all([
    ownerIds.length ? client.salesTarget.findMany({ where: { userId: { in: ownerIds }, year, currencyCode, archivedAt: null }, select: { userId: true, quarter: true, targetAmount: true } }) : Promise.resolve([]),
    ownerIds.length ? Promise.all(quarters.map(quarter => forecastForTeam(client, actor, { users: selectedUsers, year, quarter, currencyCode }))) : Promise.resolve([]),
    ownerIds.length ? client.opportunity.findMany({ where: { AND: [operationalOpportunityWhere, opportunityScope(actor), { ownerId: { in: ownerIds }, stage: { isClosed: false }, forecastCategory: { in: [ForecastCategory.PIPELINE, ForecastCategory.BEST_CASE, ForecastCategory.COMMIT] }, currencyCode, expectedCloseDate: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) } }] }, select: { id: true, ownerId: true, name: true, stage: { select: { name: true, probability: true } }, forecastCategory: true, expectedCloseDate: true, probability: true, currencyCode: true, participants: { select: { accountId: true, account: { select: { name: true } } } }, products: { where: { archivedAt: null }, select: { id: true, skuId: true, sku: { select: { partNumber: true } }, product: { select: { name: true, sku: true } }, quantity: true, estimatedUnitPrice: true } } }, orderBy: [{ expectedCloseDate: 'asc' }, { id: 'asc' }] }) : Promise.resolve([]),
  ]);
  const userById = new Map(selectedUsers.map(u => [u.id, u]));
  const planByOwner = new Map(plans.map(p => [p.ownerId, p]));
  const summary = selectedUsers.map(user => {
    const plan = planByOwner.get(user.id)!;
    const annual = sum(plan.lines.map(line => line.annualPlannedRevenue));
    const hasRevenue = plan.lines.some(line => line.annualPlannedRevenue !== null);
    const target = annualTargetFromRows([user.id], targetRows);
    const qPlan = quarters.map(quarter => sum(plan.lines.flatMap(line => line.allocations.filter(a => a.quarter === quarter).map(a => a.plannedRevenue))));
    const qTarget = quarters.map(quarter => targetRows.find(t => t.userId === user.id && t.quarter === quarter)?.targetAmount ?? null);
    const metrics = forecastQuarters.map(q => q.reps.find(rep => rep.userId === user.id));
    return { rep: repName(user), target: amount(target.amount), plan: hasRevenue ? amount(annual) : null, difference: hasRevenue && target.amount ? amount(annual.sub(target.amount)) : null, planPercent: hasRevenue && target.amount?.gt(0) ? annual.div(target.amount).toNumber() : null, qPlan: qPlan.map(amount), qTarget: qTarget.map(amount), pipeline: Number(sum(metrics.map(m => m?.pipeline ? new Prisma.Decimal(m.pipeline) : zero))), bestCase: Number(sum(metrics.map(m => m?.bestCase ? new Prisma.Decimal(m.bestCase) : zero))), commit: Number(sum(metrics.map(m => m?.commit ? new Prisma.Decimal(m.commit) : zero))) };
  });
  const approved = plans.flatMap(plan => plan.lines.map(line => ({
    rep: repName(userById.get(plan.ownerId)!), account: line.account?.name ?? line.originalAccountText ?? 'Unresolved Account', planItem: line.planItem ?? '', product: line.productSku?.product.name ?? '', sku: line.productSku?.partNumber ?? line.originalSkuText ?? 'Unresolved SKU', units: amount(line.annualPlannedUnits), revenue: amount(line.annualPlannedRevenue), priorRevenue: amount(line.priorYearRevenue), quarters: quarters.map(q => { const a = line.allocations.find(x => x.quarter === q); return [amount(a?.plannedUnits), amount(a?.plannedRevenue)]; }), allocationStatus: allocationSummary(line).status, comments: line.comments ?? '', revision: plan.revision, status: 'Active', ownerId: plan.ownerId, accountId: line.accountId, skuId: line.productSkuId,
  })));
  const plannedKeys = new Set(approved.filter(p => p.accountId && p.skuId).map(p => key(p.ownerId, p.accountId!, p.skuId!)));
  const pipeline = opportunities.flatMap(opportunity => {
    const participant = opportunity.participants.length === 1 ? opportunity.participants[0] : null;
    const accountStatus = opportunity.participants.length === 1 ? 'Single participating Account' : opportunity.participants.length ? 'Ambiguous: multiple Accounts' : 'Unresolved Account';
    const account = participant?.account.name ?? (opportunity.participants.map(p => p.account.name).sort().join(', ') || 'Unresolved Account');
    const total = Number(opportunityTotal(opportunity.products));
    return opportunity.products.map(product => {
      const match = participant && product.skuId ? plannedKeys.has(key(opportunity.ownerId!, participant.accountId, product.skuId)) : false;
      const matchStatus = !participant ? accountStatus : !product.skuId ? 'Unresolved SKU' : match ? 'Planned' : 'Unplanned Upside';
      return { rep: repName(userById.get(opportunity.ownerId!)!), account, opportunity: opportunity.name, stage: opportunity.stage.name, category: opportunity.forecastCategory === ForecastCategory.BEST_CASE ? 'Best Case' : opportunity.forecastCategory === ForecastCategory.COMMIT ? 'Commit' : 'Pipeline', date: opportunity.expectedCloseDate!, quarter: `Q${Math.floor(opportunity.expectedCloseDate!.getUTCMonth() / 3) + 1}`, product: product.product.name, sku: product.sku?.partNumber ?? product.product.sku ?? 'Unresolved SKU', quantity: product.quantity, unitPrice: amount(product.estimatedUnitPrice)!, value: Number(lineTotal(product)), opportunityTotal: total, currency: opportunity.currencyCode, probability: (opportunity.probability ?? opportunity.stage.probability) / 100, planned: match ? 'Yes' : 'No', matchStatus, ownerId: opportunity.ownerId!, accountId: participant?.accountId ?? null, skuId: product.skuId, productLineId: product.id };
    });
  });
  type Comparison = { rep: string; account: string; product: string; sku: string; planned: Prisma.Decimal; units: Prisma.Decimal; hasPlan: boolean; hasPlannedRevenue: boolean; hasPlannedUnits: boolean; pipeline: Prisma.Decimal; bestCase: Prisma.Decimal; commit: Prisma.Decimal; matchStatus?: string };
  const grouped = new Map<string, Comparison>();
  approved.forEach((line, index) => {
    const resolved = line.accountId && line.skuId;
    const k = resolved ? key(line.ownerId, line.accountId!, line.skuId!) : `unresolved:${index}`;
    const row = grouped.get(k) ?? { rep: line.rep, account: line.account, product: line.product, sku: line.sku, planned: zero, units: zero, hasPlan: true, hasPlannedRevenue: false, hasPlannedUnits: false, pipeline: zero, bestCase: zero, commit: zero, matchStatus: resolved ? undefined : 'Unresolved Plan Match' };
    row.planned = row.planned.add(line.revenue ?? zero); row.units = row.units.add(line.units ?? zero); row.hasPlannedRevenue ||= line.revenue !== null; row.hasPlannedUnits ||= line.units !== null;
    grouped.set(k, row);
  });
  pipeline.forEach((line, index) => {
    const resolved = line.accountId && line.skuId;
    const k = resolved ? key(line.ownerId, line.accountId!, line.skuId!) : `pipeline-unresolved:${index}`;
    const row = grouped.get(k) ?? { rep: line.rep, account: line.account, product: line.product, sku: line.sku, planned: zero, units: zero, hasPlan: false, hasPlannedRevenue: false, hasPlannedUnits: false, pipeline: zero, bestCase: zero, commit: zero, matchStatus: resolved ? undefined : line.matchStatus };
    row.pipeline = row.pipeline.add(line.value);
    if (line.category === 'Best Case') row.bestCase = row.bestCase.add(line.value);
    if (line.category === 'Commit') row.commit = row.commit.add(line.value);
    grouped.set(k, row);
  });
  const comparison = [...grouped.values()].map(row => ({ ...row, planned: row.hasPlannedRevenue ? amount(row.planned) : null, units: row.hasPlannedUnits ? amount(row.units) : null, pipeline: amount(row.pipeline)!, bestCase: amount(row.bestCase)!, commit: amount(row.commit)!, pipelineDifference: row.hasPlannedRevenue ? amount(row.pipeline.sub(row.planned)) : null, commitDifference: row.hasPlannedRevenue ? amount(row.commit.sub(row.planned)) : null, classification: row.matchStatus ?? (!row.hasPlan ? 'Unplanned Upside' : !row.hasPlannedRevenue ? 'Planned — Revenue Unavailable' : row.pipeline.isZero() ? 'No Current Pipeline' : row.pipeline.lt(row.planned) ? 'Plan Gap' : 'Pipeline Supports Plan') }));
  const scope = userId === null ? 'All planned reps' : repName(selectedUsers[0] ?? users.find(u => u.id === userId) ?? { firstName: 'Selected', lastName: 'rep' });
  const filename = exportFilename(year, currencyCode, userId === null ? undefined : scope);
  const workbook = salesPlanManagementWorkbook({ year, currencyCode, scope, generatedAt, generatedBy: actor.name ?? 'SalesHub user', missingPlanReps: userId === null ? population.missingPlanReps : 0, summary, approved, pipeline, comparison });
  return { filename, workbook, data: { summary, approved, pipeline, comparison } };
}

export function writeSalesPlanWorkbook(workbook: XLSX.WorkBook) {
  const files = unzipSync(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx', compression: true }) as Buffer);
  let styles = strFromU8(files['xl/styles.xml']);
  const xfCount = Number(/<cellXfs count="(\d+)"/.exec(styles)?.[1]);
  styles = styles.replace(/<fonts count="(\d+)">([\s\S]*?)<\/fonts>/, (_match, count: string, body: string) => `<fonts count="${Number(count) + 1}">${body}<font><b/><sz val="12"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts>`);
  styles = styles.replace(/<fills count="(\d+)">([\s\S]*?)<\/fills>/, (_match, count: string, body: string) => `<fills count="${Number(count) + 2}">${body}<fill><patternFill patternType="solid"><fgColor rgb="FF243B53"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8EFF5"/><bgColor indexed="64"/></patternFill></fill></fills>`);
  styles = styles.replace(/<cellXfs count="(\d+)">([\s\S]*?)<\/cellXfs>/, (_match, count: string, body: string) => {
    const originals = body.match(/<xf\b[^>]*\/>/g) ?? [];
    const totals = originals.map(xf => xf.replace(/ fillId="\d+"/, ' fillId="3"').replace('/>', ' applyFill="1"/>')).join('');
    return `<cellXfs count="${Number(count) * 2 + 2}">${body}<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>${totals}<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf></cellXfs>`;
  });
  files['xl/styles.xml'] = strToU8(styles);
  for (let index = 1; index <= 4; index++) {
    const path = `xl/worksheets/sheet${index}.xml`;
    let xml = strFromU8(files[path]);
    const header = index === 1 ? 10 : 1;
    const lastRow = index === 1 ? XLSX.utils.decode_range(workbook.Sheets['Executive Summary']['!ref']!).e.r + 1 : null;
    const total = lastRow && workbook.Sheets['Executive Summary'][`A${lastRow}`]?.v === 'Team Total' ? lastRow : null;
    const rowStyle = (cells: string, style: number, retainNumberFormat = false) => cells.replace(/<c\b([^>]*)>/g, (_cell, attrs: string) => {
      const original = Number(/ s="(\d+)"/.exec(attrs)?.[1] ?? 0);
      return `<c${attrs.replace(/ s="\d+"/, '')} s="${retainNumberFormat ? style + original : style}">`;
    });
    xml = xml.replace('<sheetView workbookViewId="0"/>', `<sheetView workbookViewId="0"><pane ySplit="${header}" topLeftCell="A${header + 1}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A${header + 1}" sqref="A${header + 1}"/></sheetView>`);
    xml = xml.replace(new RegExp(`(<row r="${header}"[^>]*>)([\\s\\S]*?)(<\\/row>)`), (_match, open: string, cells: string, close: string) => open + rowStyle(cells, xfCount) + close);
    if (total && index === 1) xml = xml.replace(new RegExp(`(<row r="${total}"[^>]*>)([\\s\\S]*?)(<\\/row>)`), (_match, open: string, cells: string, close: string) => open + rowStyle(cells, xfCount + 1, true) + close);
    if (index === 2) xml = xml.replace(/<c r="R(\d+)"([^>]*)>/g, (_cell, row: string, attrs: string) => Number(row) > 1 ? `<c r="R${row}"${attrs.replace(/ s="\d+"/, '')} s="${xfCount * 2 + 1}">` : _cell);
    files[path] = strToU8(xml);
  }
  return Buffer.from(zipSync(files, { level: 6 }));
}
