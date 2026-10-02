import { createHash } from 'node:crypto';
import { Prisma, SalesQuarter, type PrismaClient } from '@prisma/client';
import { can, type Actor } from './authorization';
import { quarters } from './forecast';

type TargetRow = { id: number; quarter: SalesQuarter; targetAmount: Prisma.Decimal; updatedAt: Date };
export type SyncStatus = 'No Target' | 'In Sync' | 'Out of Sync' | 'Target Incomplete' | 'Conflict' | 'Cannot sync — no planned revenue';
const zero = new Prisma.Decimal(0);

export function splitAnnualTarget(annual: Prisma.Decimal) {
  if (annual.lt(0) || annual.decimalPlaces() > 2 || annual.gt('9999999999999999.99')) throw new Error('Annual planned revenue is outside target limits.');
  const cents = annual.mul(100);
  const base = cents.div(4).toDecimalPlaces(0, Prisma.Decimal.ROUND_DOWN);
  const remainder = cents.mod(4).toNumber();
  return quarters.map((_, i) => base.add(i < remainder ? 1 : 0).div(100));
}

export function targetSyncStatus(annual: Prisma.Decimal | null, rows: Pick<TargetRow, 'quarter' | 'targetAmount'>[]): SyncStatus {
  if (rows.some(row => rows.filter(other => other.quarter === row.quarter).length > 1)) return 'Conflict';
  if (annual === null) return 'Cannot sync — no planned revenue';
  if (!rows.length) return 'No Target';
  if (rows.length !== 4 || quarters.some(q => !rows.some(row => row.quarter === q))) return 'Target Incomplete';
  const proposed = splitAnnualTarget(annual);
  return quarters.every((q, i) => rows.find(row => row.quarter === q)!.targetAmount.equals(proposed[i])) ? 'In Sync' : 'Out of Sync';
}

function fingerprint(planId: number, annual: Prisma.Decimal | null, rows: TargetRow[]) {
  return createHash('sha256').update(JSON.stringify({planId, annual: annual?.toFixed(2) ?? null,
    targets: rows.map(row => [row.id, row.quarter, row.targetAmount.toFixed(2), row.updatedAt.toISOString()]).sort((a,b) => Number(a[0]) - Number(b[0]))})).digest('hex');
}

function check(actor: Actor, userId: number, year: number, currencyCode: string) {
  if (!can(actor, 'sales-plan.manage')) throw new Error('Access denied');
  if (!Number.isSafeInteger(userId) || userId <= 0 || !Number.isInteger(year) || year < 2000 || year > 2100 || !/^[A-Z]{3}$/.test(currencyCode)) throw new Error('Choose a valid rep, year, and currency.');
}

export async function previewTargetSync(client: PrismaClient, actor: Actor, input: {userId:number;year:number;currencyCode:string}) {
  check(actor, input.userId, input.year, input.currencyCode);
  const [plans, targets, owner] = await Promise.all([
    client.salesPlan.findMany({where:{ownerId:input.userId,planYear:input.year,currencyCode:input.currencyCode,status:'ACTIVE'},select:{id:true,revision:true,lines:{select:{annualPlannedRevenue:true}}}}),
    client.salesTarget.findMany({where:{userId:input.userId,year:input.year,currencyCode:input.currencyCode,archivedAt:null},select:{id:true,quarter:true,targetAmount:true,updatedAt:true}}),
    client.user.findUnique({where:{id:input.userId},select:{id:true,firstName:true,lastName:true,role:true,active:true,archivedAt:true}}),
  ]);
  if (!owner?.active || owner.archivedAt || !['SALES','SALES_MANAGER'].includes(owner.role)) throw new Error('Choose an active sales rep.');
  if (plans.length !== 1) throw new Error('One active official Sales Plan is required.');
  const plan = plans[0];
  const revenue = plan.lines.filter(line => line.annualPlannedRevenue !== null);
  const annual = revenue.length ? revenue.reduce((sum,line) => sum.add(line.annualPlannedRevenue!),zero) : null;
  const status = targetSyncStatus(annual, targets);
  const proposed = annual === null ? null : splitAnnualTarget(annual);
  const current = quarters.map(q => targets.filter(row => row.quarter === q));
  const currentAnnual = targets.reduce((sum,row) => sum.add(row.targetAmount),zero);
  return {owner,year:input.year,currencyCode:input.currencyCode,planId:plan.id,revision:plan.revision,annual,status,
    current, currentAnnual, proposed, difference: annual === null ? null : annual.sub(currentAnnual),
    snapshot:fingerprint(plan.id,annual,targets)};
}

export async function confirmTargetSync(client: PrismaClient, actor: Actor, input: {userId:number;year:number;currencyCode:string;planId:number;snapshot:string}) {
  check(actor,input.userId,input.year,input.currencyCode);
  if (!Number.isSafeInteger(input.planId) || input.planId <= 0 || !/^[a-f0-9]{64}$/.test(input.snapshot)) throw new Error('Review the sync preview again.');
  return client.$transaction(async tx => {
    const preview = await previewTargetSync(tx as PrismaClient,actor,input);
    if (preview.planId !== input.planId || preview.snapshot !== input.snapshot) throw new Error('The active Sales Plan or targets changed since preview. Refresh and review again.');
    if (!preview.proposed || preview.status === 'Conflict') throw new Error(preview.status === 'Conflict' ? 'Duplicate active targets must be resolved before syncing.' : 'The official plan has no Annual Planned Revenue.');
    const prior = preview.current.flat().map(row => ({id:row.id,quarter:row.quarter,amount:row.targetAmount.toFixed(2)}));
    const resulting: {id:number;quarter:SalesQuarter;amount:string}[] = [];
    for (let i=0; i<4; i++) {
      const quarter=quarters[i], amount=preview.proposed[i];
      const existing=preview.current[i][0];
      const row=existing
        ? await tx.salesTarget.update({where:{id:existing.id},data:{targetAmount:amount,updatedById:actor.id}})
        : await tx.salesTarget.create({data:{userId:input.userId,year:input.year,currencyCode:input.currencyCode,quarter,targetAmount:amount,createdById:actor.id}});
      resulting.push({id:row.id,quarter,amount:amount.toFixed(2)});
    }
    await tx.salesTargetSync.create({data:{actorId:actor.id,planId:preview.planId,userId:input.userId,year:input.year,currencyCode:input.currencyCode,sourceAnnualAmount:preview.annual!,priorTargets:prior,resultingTargets:resulting}});
    return {auditPlanId:preview.planId,annual:preview.annual!.toFixed(2)};
  },{isolationLevel:'Serializable'});
}
