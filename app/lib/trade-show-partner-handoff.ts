import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import * as XLSX from 'xlsx';
import { Prisma, type PrismaClient, type TradeShowLead } from '@prisma/client';
import { assertPermission, can, type Actor } from './authorization';
import { readModules } from './module-availability';
import { tradeShowLeadReadWhere } from './trade-shows';
import { eligiblePartnerAccountWhere } from './trade-show-routing';
import { actionablePartnerStatuses } from './trade-show-partner-state';
import { eligibleUser, eligibleUserWhere } from './assignment-eligibility';
import { followUpDueDate } from './trade-show-follow-up';
import { tradeShowFollowUpBusinessDays } from './configuration';
import { nextUpdatedAt, RecordChangedError } from './stale-edit';
import { notifyTaskAssignment } from './work-notification-evaluator';

export const legacyPartnerExportHeaders = ['First Name','Last Name','Company','Title','Email','Phone','City','State/Region','Country','Product Interest','Lead Qualification','Trade Show','Trade Show Date','Partner Handoff Notes','BIXOLON Internal Owner','Partner'];
export const partnerExportHeaders = [...legacyPartnerExportHeaders, 'Source Notes', 'Competitor Mentioned', 'Current Product Being Used', 'Customer Pain Points'];
export const PARTNER_BATCH_TASK_SOURCE = 'TRADE_SHOW_PARTNER_HANDOFF';
export function partnerExportFilename(show: string, partner: string, now: Date) {
  const slug = (value: string, fallback: string) => value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0,48) || fallback;
  return `SalesHub_${slug(show,'Trade_Show')}_${slug(partner,'Partner')}_Leads_${now.toISOString().replace(/[^0-9]/g,'')}_${randomUUID().slice(0,8)}.xlsx`;
}
const person = (u: { firstName: string; lastName: string } | null) => u ? `${u.firstName} ${u.lastName}` : '';
export function partnerExportRow(lead: Pick<TradeShowLead, 'firstName'|'lastName'|'sourceCompany'|'title'|'email'|'phone'|'city'|'stateProvince'|'country'|'productInterest'|'status'|'partnerHandoffNotes'|'sourceNotes'|'competitorSourceText'|'currentProductBeingUsed'|'customerPainPoints'>, show: {name: string; startDate: Date | null}, partner: string, owner: string) {
  return [lead.firstName,lead.lastName,lead.sourceCompany,lead.title,lead.email,lead.phone,lead.city,lead.stateProvince,lead.country,lead.productInterest,lead.status,show.name,show.startDate?.toISOString().slice(0,10),lead.partnerHandoffNotes,owner,partner,lead.sourceNotes,lead.competitorSourceText,lead.currentProductBeingUsed,lead.customerPainPoints].map(value => value ?? '');
}
export function partnerWorkbook(rows: string[][]): Buffer {
  const safe = (value: string) => /^[\s\u0000-\u001f]*[=+@-]|^[\t\r\n]/u.test(value) ? "'" + value : value;
  // The stored row width identifies the approved disclosure format. Never enrich old handoffs.
  const headers = rows[0]?.length === legacyPartnerExportHeaders.length ? legacyPartnerExportHeaders : partnerExportHeaders;
  if (rows.some(row => row.length !== headers.length || row.some(cell => typeof cell !== 'string' || cell.length > 32767))) throw new Error('Invalid partner export snapshot.');
  const sheet = XLSX.utils.aoa_to_sheet([headers, ...rows.map(row => row.map(safe))]);
  // AOA strings are explicit text cells; never create formulas or hyperlinks.
  const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, sheet, 'Partner Leads');
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx', compression: true });
}
export const awaitingPartnerWhere = (tradeShowId: number, partnerAccountId?: number): Prisma.TradeShowLeadWhereInput => ({
  tradeShowId, routing: 'REFERRED_TO_PARTNER', routedPartnerAccountId: partnerAccountId ?? { not: null },
  partnerHandoffStatus: 'AWAITING_PARTNER_HANDOFF', status: { in: actionablePartnerStatuses }, convertedOpportunityId: null,
});
async function authorized(tx: Prisma.TransactionClient, actor: Actor, mutate = false) {
  assertPermission(actor, mutate ? 'trade-shows.partner-handoff' : 'trade-shows.read');
  const current = await tx.user.findUnique({ where: { id: actor.id } });
  assertPermission(current, mutate ? 'trade-shows.partner-handoff' : 'trade-shows.read');
  if (!(await readModules(tx as unknown as PrismaClient)).effective.has('TRADE_SHOWS')) throw new Error('Module unavailable: Trade Shows.');
  return current!;
}
const validId = (id: number) => { if (!Number.isSafeInteger(id) || id < 1) throw new Error('Invalid handoff selection.'); };
async function selection(tx: Prisma.TransactionClient, tradeShowId: number, partnerAccountId: number, actorId: number) {
  validId(tradeShowId); validId(partnerAccountId);
  const show = await tx.tradeShow.findUnique({ where: { id: tradeShowId }, include: { marketingOwner: { select: { firstName: true, lastName: true } } } });
  if (!show || show.archivedAt) throw new Error('Choose an active Trade Show.');
  const partner = await tx.account.findFirst({ where: { id: partnerAccountId, ...eligiblePartnerAccountWhere }, select: { id: true, name: true, updatedAt: true } });
  if (!partner) throw new Error('Choose an active eligible Partner Account.');
  const leads = await tx.tradeShowLead.findMany({ where: awaitingPartnerWhere(tradeShowId, partnerAccountId), include: { assignedSalesRep: { select: { firstName: true, lastName: true } } }, orderBy: { id: 'asc' } });
  if (!leads.length) throw new Error('Choose a partner with Awaiting Handoff leads. Refresh the page.');
  if (leads.length > 10000) throw new Error('A handoff can include up to 10,000 leads.');
  const rows = leads.map(lead => partnerExportRow(lead, show, partner.name, person(lead.assignedSalesRep ?? show.marketingOwner)));
  const candidateIds = [...new Set([show.marketingOwnerId, actorId, ...leads.map(lead=>lead.partnerFollowUpOwnerId)].filter((id):id is number=>id!==null))];
  const owners = await tx.user.findMany({where:{id:{in:candidateIds},...eligibleUserWhere('general-task')},select:{id:true,firstName:true,lastName:true,updatedAt:true}});
  const fallback = owners.find(owner=>owner.id===show.marketingOwnerId) ?? owners.find(owner=>owner.id===actorId);
  const resolved = leads.map(lead=>lead.partnerFollowUpOwnerId ? owners.find(owner=>owner.id===lead.partnerFollowUpOwnerId) : fallback);
  if (resolved.some(owner=>!owner)) throw new Error('Choose an active Follow-up Owner for these leads before completing the handoff.');
  const followUpOwner = resolved[0]!;
  if (resolved.some(owner=>owner!.id!==followUpOwner.id)) throw new Error('These leads have different Follow-up Owners. Choose the same Follow-up Owner for all awaiting leads before completing the handoff.');
  const businessDays = await tradeShowFollowUpBusinessDays(tx as unknown as PrismaClient);
  const digest = createHash('sha256').update(JSON.stringify({ show: [show.id, show.updatedAt, show.marketingOwnerId], partner, leads: leads.map(l => [l.id, l.updatedAt, l.partnerAssignmentVersion, l.partnerFollowUpOwnerId]), rows, businessDays, followUpOwner })).digest('hex');
  return { show, partner, leads, rows, digest, businessDays, followUpOwner };
}
function key() { if (!process.env.AUTH_SECRET) throw new Error('Partner export signing is unavailable.'); return process.env.AUTH_SECRET; }
function sign(actorId: number, digest: string) {
  const body = `${actorId}.${Date.now() + 15 * 60_000}.${digest}`;
  return `${body}.${createHmac('sha256', key()).update(body).digest('hex')}`;
}
function verify(token: string, actorId: number, digest: string) {
  const parts = token.split('.'); const [id, expires, hash, signature] = parts;
  const expected = createHmac('sha256', key()).update(`${id}.${expires}.${hash}`).digest('hex');
  if (parts.length !== 4 || id !== String(actorId) || !/^\d+$/.test(expires) || Number(expires) < Date.now() || hash !== digest || !signature || !/^[a-f0-9]{64}$/.test(signature) || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) throw new RecordChangedError();
}
export async function previewPartnerHandoff(db: PrismaClient, actor: Actor, showId: number, partnerId: number) {
  return db.$transaction(async tx => {
    const current = await authorized(tx, actor, true);
    const s = await selection(tx, showId, partnerId, current.id);
    return { partner: s.partner.name, tradeShow: s.show.name, count: s.leads.length, followUpOwner: person(s.followUpOwner), token: sign(actor.id, s.digest), businessDays: s.businessDays };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}
async function lockHandoffModule(tx: Prisma.TransactionClient) {
  await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(72341025)`;
  // The waiting advisory-lock SELECT already establishes a serializable snapshot.
  // Lock the persisted setting too: a disable committed while waiting must abort
  // that stale snapshot rather than authorize disclosure from the old enabled value.
  try {
    await tx.$queryRaw`SELECT 1 AS locked FROM "DeploymentModuleVisibility" WHERE module = 'TRADE_SHOWS' FOR SHARE`;
  } catch (error) {
    // Prisma exposes raw-query serialization failures as P2010/40001.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2010' && error.meta?.code === '40001') throw new RecordChangedError();
    throw error;
  }
}
export async function finalizePartnerHandoff(db: PrismaClient, actor: Actor, showId: number, partnerId: number, token: string, workbook = partnerWorkbook) {
  validId(showId); validId(partnerId);
  assertPermission(actor, 'trade-shows.partner-handoff');
  return db.$transaction(async tx => {
    // Shared with module configuration: a disable cannot race a disclosure commit.
    await lockHandoffModule(tx);
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${actor.id} FOR SHARE`;
    const current = await authorized(tx, actor, true);
    await tx.$queryRaw`SELECT id FROM "TradeShow" WHERE id = ${showId} FOR SHARE`;
    await tx.$queryRaw`SELECT id FROM "Account" WHERE id = ${partnerId} FOR SHARE`;
    await tx.$queryRaw`SELECT "accountId" FROM "AccountBusinessRole" WHERE "accountId" = ${partnerId} ORDER BY role FOR SHARE`;
    await tx.$queryRaw`SELECT id FROM "TradeShowLead" WHERE "tradeShowId" = ${showId} AND "routedPartnerAccountId" = ${partnerId} ORDER BY id FOR UPDATE`;
    const s = await selection(tx, showId, partnerId, current.id);
    verify(token, current.id, s.digest);
    const assigneeIds = [...new Set([s.followUpOwner.id, current.id])].sort((a,b) => a-b);
    await tx.$queryRaw(Prisma.sql`SELECT id FROM "User" WHERE id IN (${Prisma.join(assigneeIds)}) ORDER BY id FOR SHARE`);
    const assignee = await tx.user.findFirst({where:{id:s.followUpOwner.id,...eligibleUserWhere('general-task')},select:{id:true}});
    if (!assignee) throw new Error('Choose an active Follow-up Owner before completing the handoff.');
    // Generate exactly this locked snapshot before any durable handoff writes.
    const bytes = workbook(s.rows);
    const now = new Date();
    const filename = partnerExportFilename(s.show.name, s.partner.name, now);
    const task = await tx.task.create({ data: {
      source: PARTNER_BATCH_TASK_SOURCE, accountId: partnerId,
      subject: `Follow up with ${s.partner.name} on ${s.leads.length} ${s.show.name} ${s.leads.length === 1 ? 'lead' : 'leads'}`.slice(0,200),
      description: `Follow up with ${s.partner.name} regarding the ${s.leads.length} ${s.leads.length === 1 ? 'lead' : 'leads'} sent from ${s.show.name}.\n\nThe partner handoff was completed and the export is ready to send through the normal business channel.`,
      assignedToId: assignee.id, originalAssigneeId: assignee.id, createdById: current.id, updatedById: current.id,
      dueDate: followUpDueDate(now, s.businessDays), status: 'OPEN', priority: 'NORMAL',
    } });
    const batch = await tx.tradeShowPartnerHandoff.create({ data: {
      tradeShowId: showId, partnerAccountId: partnerId, partnerName: s.partner.name, tradeShowName: s.show.name,
      performedById: current.id, handedOffAt: now, leadCount: s.leads.length, filename, taskId: task.id,
      leads: { create: s.leads.map((lead, i) => ({ leadId: lead.id, assignmentVersion: lead.partnerAssignmentVersion, exportRow: s.rows[i] })) },
    } });
    for (const lead of s.leads) {
      const result = await tx.tradeShowLead.updateMany({ where: { ...awaitingPartnerWhere(showId, partnerId), id: lead.id, updatedAt: lead.updatedAt, partnerAssignmentVersion: lead.partnerAssignmentVersion }, data: { partnerHandoffStatus: 'SENT_TO_PARTNER', partnerSentAt: now, updatedAt: nextUpdatedAt(lead.updatedAt) } });
      if (result.count !== 1) throw new RecordChangedError();
    }
    const event = await tx.taskAssignmentEvent.create({ data: { taskId: task.id, fromUserId: null, toUserId: assignee.id, actorId: current.id } });
    await notifyTaskAssignment(tx, task.id, assignee.id, event.id);
    await tx.adminMaintenanceEvent.create({ data: { actorId: current.id, entityType: 'Trade Show Lead', action: 'Partner handoff sent', recordIds: s.leads.slice(0,20).map(l => l.id), recordCount: s.leads.length, newValue: `Batch ${batch.id}; Trade Show ${showId}; Partner ${partnerId}; SENT_TO_PARTNER` } });
    return { bytes, filename, batchId: batch.id };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 60000 });
}
export async function historicalPartnerExport(db: PrismaClient, actor: Actor, showId: number, batchId: number) {
  validId(showId); validId(batchId);
  return db.$transaction(async tx => {
    await lockHandoffModule(tx);
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${actor.id} FOR SHARE`;
    await authorized(tx, actor, true);
    const batch = await tx.tradeShowPartnerHandoff.findFirst({ where: { id: batchId, tradeShowId: showId }, include: { leads: { orderBy: { leadId: 'asc' } } } });
    if (!batch) throw new Error('Not found: partner handoff.');
    const bytes = partnerWorkbook(batch.leads.map(item => item.exportRow as string[]));
    await tx.adminMaintenanceEvent.create({ data: { actorId: actor.id, entityType: 'Trade Show Lead', action: 'Historical re-export', recordIds: [], recordCount: batch.leadCount, newValue: `Batch ${batch.id}; Trade Show ${showId}; Partner ${batch.partnerAccountId}` } });
    return { bytes, filename: `Historical_${batch.filename}`, batchId };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 60000 });
}

export async function loadPartnerHandoffs(db: PrismaClient, actor: Actor, showId: number, partnerId?: number, page = 1, historyPage = 1) {
  validId(showId); if (partnerId !== undefined) validId(partnerId);
  return db.$transaction(async tx => {
    const current = await authorized(tx, actor);
    const show = await tx.tradeShow.findUnique({ where: { id: showId }, select: { id: true, name: true, archivedAt: true, marketingOwner: { select: { firstName: true, lastName: true, active: true, archivedAt: true, role: true } } } });
    if (!show) throw new Error('Not found: Trade Show.');
    const scope = tradeShowLeadReadWhere(current);
    const groups = await tx.tradeShowLead.groupBy({ by: ['routedPartnerAccountId','partnerHandoffStatus'], where: { AND: [scope, { tradeShowId: showId, routing: 'REFERRED_TO_PARTNER', partnerHandoffStatus: { not: null }, OR: [{ partnerHandoffStatus: 'SENT_TO_PARTNER' }, { status: { in: actionablePartnerStatuses }, convertedOpportunityId: null }] }] }, _count: true, _min: { partnerAwaitingAt: true } });
    const partnerIds = [...new Set(groups.map(g => g.routedPartnerAccountId!))];
    const partners = await tx.account.findMany({ where: { id: { in: partnerIds } }, select: { id: true, name: true }, orderBy: { name: 'asc' } });
    const historyWhere: Prisma.TradeShowPartnerHandoffWhereInput = { tradeShowId: showId, ...(partnerId ? { partnerAccountId: partnerId } : {}), ...(current.role === 'SALES' ? { leads: { some: { lead: scope } } } : {}) };
    const latest = await tx.tradeShowPartnerHandoff.findMany({ distinct: ['partnerAccountId'], where: { ...historyWhere, partnerAccountId: { in: partnerIds } }, orderBy: [{handedOffAt:'desc'},{id:'desc'}], select: {partnerAccountId:true,handedOffAt:true,task:{select:{originalAssignee:{select:{firstName:true,lastName:true}}}}} });
    const awaitingOwners = await tx.tradeShowLead.groupBy({by:['routedPartnerAccountId','partnerFollowUpOwnerId'],where:{AND:[scope,awaitingPartnerWhere(showId)]}});
    const ownerIds = [...new Set(awaitingOwners.map(group=>group.partnerFollowUpOwnerId).filter((id):id is number=>id!==null))];
    const owners = await tx.user.findMany({where:{id:{in:ownerIds}},select:{id:true,firstName:true,lastName:true}});
    const aging = await tx.tradeShowLead.groupBy({ by: ['routedPartnerAccountId'], where: { AND: [scope, awaitingPartnerWhere(showId), { partnerAwaitingAt: { lte: new Date(Date.now() - 7*86400000) } }] }, _count: true });
    const leadWhere: Prisma.TradeShowLeadWhereInput = { AND: [scope, { tradeShowId: showId, routing: 'REFERRED_TO_PARTNER', routedPartnerAccountId: partnerId ?? -1 }] };
    const count = partnerId ? await tx.tradeShowLead.count({ where: leadWhere }) : 0;
    page = Math.max(1, Math.min(Math.ceil(count / 20) || 1, page));
    const leads = partnerId ? await tx.tradeShowLead.findMany({ where: leadWhere, select: { id: true, firstName: true, lastName: true, sourceCompany: true, status: true, partnerHandoffStatus: true, partnerAwaitingAt: true, partnerSentAt: true, partnerFollowUpOwner: {select:{firstName:true,lastName:true}}, partnerHandoffItems: {orderBy:{batchId:'desc'},take:1,select:{batch:{select:{task:{select:{originalAssignee:{select:{firstName:true,lastName:true}}}}}}}}, assignedSalesRep: { select: { firstName: true, lastName: true } } }, orderBy: { id: 'asc' }, skip: (page-1)*20, take: 20 }) : [];
    const historyCount = await tx.tradeShowPartnerHandoff.count({ where: historyWhere });
    historyPage = Math.max(1, Math.min(Math.ceil(historyCount / 20) || 1, historyPage));
    const history = await tx.tradeShowPartnerHandoff.findMany({ where: historyWhere, include: { task: {select: {originalAssignee: {select: {firstName: true,lastName: true}}}}, performedBy: { select: { firstName: true, lastName: true } } }, orderBy: [{ handedOffAt: 'desc' }, { id: 'desc' }], skip: (historyPage-1)*20, take: 20 });
    const selectedPartner = partnerId ? await tx.account.findUnique({ where: { id: partnerId }, select: { name: true } }) : null;
    // Display the owner using the existing handoff Task eligibility rule.
    const followUpOwner = eligibleUser(show.marketingOwner, 'general-task') ? show.marketingOwner : can(current, 'trade-shows.partner-handoff') && eligibleUser(current, 'general-task') ? current : null;
    return { show, followUpOwner, partners: partners.map(p => ({ ...p,
      awaiting: groups.find(g => g.routedPartnerAccountId === p.id && g.partnerHandoffStatus === 'AWAITING_PARTNER_HANDOFF')?._count ?? 0,
      sent: groups.find(g => g.routedPartnerAccountId === p.id && g.partnerHandoffStatus === 'SENT_TO_PARTNER')?._count ?? 0,
      awaitingSince: groups.find(g => g.routedPartnerAccountId === p.id && g.partnerHandoffStatus === 'AWAITING_PARTNER_HANDOFF')?._min.partnerAwaitingAt ?? null,
      aging: aging.find(g => g.routedPartnerAccountId === p.id)?._count ?? 0,
      latest: latest.find(g => g.partnerAccountId === p.id)?.handedOffAt ?? null,
      followUpOwner: [...new Set(awaitingOwners.filter(group=>group.routedPartnerAccountId===p.id).map(group=>person(group.partnerFollowUpOwnerId ? owners.find(owner=>owner.id===group.partnerFollowUpOwnerId) ?? null : followUpOwner)))].filter(Boolean).join(', ') || person(latest.find(batch=>batch.partnerAccountId===p.id)?.task.originalAssignee ?? null) || 'Unassigned',
    })), selectedPartner, leads: leads.map(lead=>({...lead,followUpOwner:person(lead.partnerHandoffStatus==='SENT_TO_PARTNER' ? lead.partnerHandoffItems[0]?.batch.task.originalAssignee ?? lead.partnerFollowUpOwner : lead.partnerFollowUpOwner ?? followUpOwner) || 'Unassigned'})), count, page, history, historyCount, historyPage };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}

export async function loadPartnerBatch(db: PrismaClient, actor: Actor, showId: number, batchId: number, page = 1) {
  validId(showId); validId(batchId);
  return db.$transaction(async tx => {
    const current = await authorized(tx, actor);
    const scope = tradeShowLeadReadWhere(current);
    const batch = await tx.tradeShowPartnerHandoff.findFirst({ where: { id: batchId, tradeShowId: showId, ...(current.role === 'SALES' ? { leads: { some: { lead: scope } } } : {}) }, include: { task: {select:{originalAssignee:{select:{firstName:true,lastName:true}}}}, performedBy: { select: { firstName: true, lastName: true } } } });
    if (!batch) throw new Error('Not found: partner handoff.');
    const where = { batchId, lead: scope };
    const count = await tx.tradeShowPartnerHandoffLead.count({ where });
    page = Math.max(1, Math.min(Math.ceil(count/20) || 1, page));
    const items = await tx.tradeShowPartnerHandoffLead.findMany({ where, select: { lead: { select: { id: true, firstName: true, lastName: true, sourceCompany: true, status: true } } }, orderBy: { leadId: 'asc' }, skip: (page-1)*20, take: 20 });
    return { batch, items, count, page };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}
