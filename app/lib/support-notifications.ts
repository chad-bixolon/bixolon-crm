import { Prisma, type PrismaClient } from '@prisma/client';
import { eligibleUserWhere } from './assignment-eligibility';
import { activeSupportStatuses,supportToday } from './support-report';

type Db=PrismaClient|Prisma.TransactionClient;
const types=['SUPPORT_FOLLOW_UP_OVERDUE'];
export async function syncSupportNotifications(db:Db,caseId:number,now=new Date()){
  const row=await db.supportCase.findUnique({where:{id:caseId},select:{id:true,caseNumber:true,assignedToId:true,status:true,archivedAt:true,nextFollowUpAt:true}});
  if(!row)return {created:0,resolved:0};
  const user=row.assignedToId?await db.user.findFirst({where:{id:row.assignedToId,...eligibleUserWhere('support-cases.write')},select:{id:true}}):null;
  const active=!!(user&&!row.archivedAt&&activeSupportStatuses.includes(row.status)&&row.nextFollowUpAt&&row.nextFollowUpAt<supportToday(now).start);
  const sourceKey=active?`SUPPORT:${caseId}:${user!.id}:FOLLOW_UP_OVERDUE:${row.nextFollowUpAt!.toISOString()}`:null;
  const current=await db.notification.findMany({where:{entityType:'SUPPORT_CASE',entityId:caseId,type:{in:types},resolvedAt:null},select:{id:true,sourceKey:true}});
  const obsolete=current.filter(item=>item.sourceKey!==sourceKey).map(item=>item.id);
  const resolved=obsolete.length?(await db.notification.updateMany({where:{id:{in:obsolete}},data:{resolvedAt:now}})).count:0;
  const created=sourceKey?(await db.notification.createMany({data:[{userId:user!.id,type:types[0],severity:'WARNING',title:'Support follow-up overdue',message:`${row.caseNumber} needs follow-up.`,entityType:'SUPPORT_CASE',entityId:caseId,actionUrl:`/support/cases/${caseId}`,sourceKey}],skipDuplicates:true})).count:0;
  return {created,resolved};
}
export async function notifySupportEvent(db:Db,caseId:number,userId:number|null,eventId:number,kind:'ASSIGNED'|'CRITICAL'|'REOPENED',caseNumber:string){
  if(!userId)return;
  const user=await db.user.findFirst({where:{id:userId,...eligibleUserWhere('support-cases.write')},select:{id:true}});if(!user)return;
  const settings={ASSIGNED:{title:'Support Case assigned to you',severity:'INFO' as const},CRITICAL:{title:'Critical Support Case needs attention',severity:'CRITICAL' as const},REOPENED:{title:'Support Case reopened',severity:'INFO' as const}}[kind];
  await db.notification.createMany({data:[{userId,type:`SUPPORT_${kind}`,severity:settings.severity,title:settings.title,message:`${caseNumber} needs your attention.`,entityType:'SUPPORT_CASE',entityId:caseId,actionUrl:`/support/cases/${caseId}`,sourceKey:`SUPPORT:${caseId}:${userId}:${kind}:${eventId}`}],skipDuplicates:true});
}
export async function evaluateSupportNotifications(db:PrismaClient,now=new Date()){
  const result={evaluated:0,created:0,resolved:0};let cursor=0;
  while(true){const rows=await db.supportCase.findMany({where:{id:{gt:cursor}},select:{id:true},orderBy:{id:'asc'},take:200});if(!rows.length)break;
    for(const row of rows){const count=await syncSupportNotifications(db,row.id,now);result.evaluated++;result.created+=count.created;result.resolved+=count.resolved;}
    cursor=rows.at(-1)!.id;
  }
  return result;
}
