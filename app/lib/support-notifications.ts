import { Prisma, type PrismaClient } from '@prisma/client';
import { eligibleUserWhere } from './assignment-eligibility';
import { activeSupportStatuses,supportToday } from './support-report';
import { notificationEnabled } from './notification-preferences';
import { reconcileNotificationBatch, type NoticeEntry } from './notification-batch';

type Db=PrismaClient|Prisma.TransactionClient;
const types=['SUPPORT_FOLLOW_UP_OVERDUE'];
export async function syncSupportNotifications(db:Db,caseId:number,now=new Date()){
  const row=await db.supportCase.findUnique({where:{id:caseId},select:{id:true,caseNumber:true,assignedToId:true,status:true,archivedAt:true,nextFollowUpAt:true}});
  if(!row)return {created:0,resolved:0};
  const user=row.assignedToId?await db.user.findFirst({where:{id:row.assignedToId,...eligibleUserWhere('support-case')},select:{id:true}}):null;
  const active=!!(user&&!row.archivedAt&&activeSupportStatuses.includes(row.status)&&row.nextFollowUpAt&&row.nextFollowUpAt<supportToday(now).start);
  const sourceKey=active?`SUPPORT:${caseId}:${user!.id}:FOLLOW_UP_OVERDUE:${row.nextFollowUpAt!.toISOString()}`:null;
  const current=await db.notification.findMany({where:{entityType:'SUPPORT_CASE',entityId:caseId,type:{in:types},resolvedAt:null},select:{id:true,sourceKey:true}});
  const obsolete=current.filter(item=>item.sourceKey!==sourceKey).map(item=>item.id);
  const resolved=obsolete.length?(await db.notification.updateMany({where:{id:{in:obsolete}},data:{resolvedAt:now}})).count:0;
  const created=sourceKey&&await notificationEnabled(db,user!.id,'SUPPORT_CASE','WARNING')?(await db.notification.createMany({data:[{userId:user!.id,type:types[0],severity:'WARNING',title:'Support follow-up overdue',message:`${row.caseNumber} needs follow-up.`,entityType:'SUPPORT_CASE',entityId:caseId,actionUrl:`/support/cases/${caseId}`,sourceKey}],skipDuplicates:true})).count:0;
  return {created,resolved};
}
export async function notifySupportEvent(db:Db,caseId:number,userId:number|null,eventId:number,kind:'ASSIGNED'|'CRITICAL'|'REOPENED',caseNumber:string){
  if(!userId)return;
  const user=await db.user.findFirst({where:{id:userId,...eligibleUserWhere('support-case')},select:{id:true}});if(!user)return;
  const settings={ASSIGNED:{title:'Support Case assigned to you',severity:'INFO' as const},CRITICAL:{title:'Critical Support Case needs attention',severity:'CRITICAL' as const},REOPENED:{title:'Support Case reopened',severity:'INFO' as const}}[kind];
  if (!await notificationEnabled(db,userId,'SUPPORT_CASE',settings.severity)) return;
  await db.notification.createMany({data:[{userId,type:`SUPPORT_${kind}`,severity:settings.severity,title:settings.title,message:`${caseNumber} needs your attention.`,entityType:'SUPPORT_CASE',entityId:caseId,actionUrl:`/support/cases/${caseId}`,sourceKey:`SUPPORT:${caseId}:${userId}:${kind}:${eventId}`}],skipDuplicates:true});
}
export async function evaluateSupportNotifications(db:PrismaClient,now=new Date()){
  if (typeof Reflect.get(db.notificationPreference ?? {}, 'findMany') === 'function') return evaluateSupportNotificationsBatched(db, now);
  const result={evaluated:0,created:0,resolved:0};let cursor=0;
  while(true){const rows=await db.supportCase.findMany({where:{id:{gt:cursor}},select:{id:true},orderBy:{id:'asc'},take:200});if(!rows.length)break;
    for(const row of rows){const count=await syncSupportNotifications(db,row.id,now);result.evaluated++;result.created+=count.created;result.resolved+=count.resolved;}
    cursor=rows.at(-1)!.id;
  }
  return result;
}

async function evaluateSupportNotificationsBatched(db: PrismaClient, now: Date) {
  const result = { evaluated: 0, created: 0, resolved: 0 };
  const cutoff = supportToday(now).start;
  let cursor = 0;
  while (true) {
    const rows = await db.supportCase.findMany({ where: { id: { gt: cursor } }, select: { id: true, caseNumber: true, assignedToId: true, status: true, archivedAt: true, nextFollowUpAt: true }, orderBy: { id: 'asc' }, take: 200 });
    if (!rows.length) break;
    const users = await db.user.findMany({ where: { id: { in: rows.map(row => row.assignedToId).filter((id): id is number => id !== null) }, ...eligibleUserWhere('support-case') }, select: { id: true } });
    const eligible = new Set(users.map(user => user.id));
    const entries: NoticeEntry[] = rows.map(row => {
      const userId = row.assignedToId !== null && eligible.has(row.assignedToId) ? row.assignedToId : null;
      const active = userId !== null && !row.archivedAt && activeSupportStatuses.includes(row.status) && !!row.nextFollowUpAt && row.nextFollowUpAt < cutoff;
      return { entityId: row.id, userId, candidates: active ? [{ type: types[0], severity: 'WARNING', title: 'Support follow-up overdue', message: `${row.caseNumber} needs follow-up.`, sourceKey: `SUPPORT:${row.id}:${userId}:FOLLOW_UP_OVERDUE:${row.nextFollowUpAt!.toISOString()}` }] : [] };
    });
    const counts = await reconcileNotificationBatch(db, 'SUPPORT_CASE', types, entries, now);
    result.evaluated += rows.length; result.created += counts.created; result.resolved += counts.resolved;
    cursor = rows.at(-1)!.id;
  }
  return result;
}
