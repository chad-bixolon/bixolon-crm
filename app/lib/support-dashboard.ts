import type { PrismaClient } from '@prisma/client';
import type { Actor } from './authorization';
import { supportCaseReadWhere } from './support-cases';
import { activeSupportStatuses, supportToday } from './support-report';
import { operationalActivityWhere } from './operational-where';
import { dashboardOpenTaskWhere, dayBounds } from './work';

export async function supportDashboard(db:PrismaClient,actor:Actor,now=new Date(),options:{intake?:boolean;tasks?:boolean;activity?:boolean}={}) {
  const base=supportCaseReadWhere(actor),active={...base,archivedAt:null,status:{in:activeSupportStatuses}},mine={...active,assignedToId:actor.id};
  const overdue={...active,nextFollowUpAt:{lt:supportToday(now).start}};
  const intakeWhere={...active,OR:[{status:'NEW' as const},{assignedToId:null}]};
  const dueBefore=new Date(dayBounds(now).start.getTime()+8*86400000);
  const [mineGroups,priorityGroups,overdueCount,criticalCases,overdueCases,oldestCases,intakeCount,intakeCases,tasks,activity]=await Promise.all([
    db.supportCase.groupBy({by:['status'],where:mine,_count:{_all:true}}),
    db.supportCase.groupBy({by:['priority'],where:active,_count:{_all:true}}),
    db.supportCase.count({where:overdue}),
    db.supportCase.findMany({where:{...active,priority:{in:['HIGH','CRITICAL']}},select:{id:true,caseNumber:true,subject:true,priority:true,customerNameText:true,account:{select:{name:true}}},orderBy:[{priority:'desc'},{openedAt:'asc'}],take:5}),
    db.supportCase.findMany({where:overdue,select:{id:true,caseNumber:true,subject:true,nextFollowUpAt:true},orderBy:[{nextFollowUpAt:'asc'},{id:'asc'}],take:5}),
    db.supportCase.findMany({where:active,select:{id:true,caseNumber:true,status:true,openedAt:true,customerNameText:true,account:{select:{name:true}}},orderBy:[{openedAt:'asc'},{id:'asc'}],take:5}),
    options.intake?db.supportCase.count({where:intakeWhere}):0,
    options.intake?db.supportCase.findMany({where:intakeWhere,select:{id:true,caseNumber:true,subject:true,status:true,assignedToId:true},orderBy:[{openedAt:'asc'},{id:'asc'}],take:5}):[],
    options.tasks?db.task.findMany({where:{...dashboardOpenTaskWhere(),assignedToId:actor.id,dueDate:{lt:dueBefore},supportCase:{is:base}},select:{id:true,subject:true,dueDate:true,supportCase:{select:{id:true,caseNumber:true}}},orderBy:[{dueDate:'asc'},{id:'asc'}],take:6}):[],
    options.activity?db.activity.findMany({where:{AND:[operationalActivityWhere],supportCase:{is:base},activityDate:{gte:new Date(now.getTime()-7*86400000),lte:now}},select:{id:true,subject:true,activityDate:true,supportCase:{select:{id:true,caseNumber:true}}},orderBy:[{activityDate:'desc'},{id:'desc'}],take:5}):[],
  ]);
  const byStatus=Object.fromEntries(mineGroups.map(g=>[g.status,g._count._all]));
  const byPriority=Object.fromEntries(priorityGroups.map(g=>[g.priority,g._count._all]));
  return {mine:{total:mineGroups.reduce((n,g)=>n+g._count._all,0),byStatus},high:byPriority.HIGH??0,critical:byPriority.CRITICAL??0,overdueCount,criticalCases,overdueCases,oldestCases,intakeCount,intakeCases,tasks,activity};
}
