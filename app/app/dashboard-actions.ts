'use server';

import type { Prisma, UserRole } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { currentUser, requireMutation } from '@/lib/current-user';
import { getEffectiveDashboardLayout, getRoleDashboardLayout, systemDashboardDefaults, validateDashboardLayout, type DashboardLayoutConfiguration, type DashboardLayoutItem } from '@/lib/dashboard';
import { prisma } from '@/lib/prisma';
import { dashboardWidgetAvailable, getModuleAvailability, reportTypeAvailable } from '@/lib/module-availability';

export type DashboardActionState={message:string};
const parse=(form:FormData)=>JSON.parse(String(form.get('configuration')??'null')) as unknown;

async function preserveUnavailableItems(previous: DashboardLayoutConfiguration, visible: DashboardLayoutConfiguration) {
  const availability=await getModuleAvailability();
  const reportIds=previous.items.flatMap(item=>item.kind==='SAVED_REPORT'?[item.reportId]:[]);
  const reports=reportIds.length?await prisma.reportDefinition.findMany({where:{id:{in:reportIds}},select:{id:true,reportType:true}}):[];
  const hidden=(item:DashboardLayoutItem)=>item.kind==='BUILTIN'?!dashboardWidgetAvailable(item.key,availability):!reportTypeAvailable(reports.find(report=>report.id===item.reportId)?.reportType??'',availability);
  const next=[...visible.items];
  const items=previous.items.flatMap(item=>hidden(item)?[item]:next.length?[next.shift()!]:[]);
  return {version:1 as const,items:[...items,...next]};
}

export async function savePersonalDashboardAction(_state:DashboardActionState,form:FormData):Promise<DashboardActionState>{
  const actor=await currentUser();
  try{
    const submitted=await validateDashboardLayout(prisma,actor,parse(form));
    const configuration=await validateDashboardLayout(prisma,actor,await preserveUnavailableItems((await getEffectiveDashboardLayout(prisma,actor)).configuration,submitted));
    await prisma.userDashboardLayout.upsert({where:{userId:actor.id},create:{userId:actor.id,role:actor.role,configuration:configuration as unknown as Prisma.InputJsonValue},update:{role:actor.role,configuration:configuration as unknown as Prisma.InputJsonValue}});
  }catch(error){return {message:error instanceof Error?error.message:'Could not save Dashboard.'};}
  revalidatePath('/');redirect('/?saved=dashboard');
}

export async function resetPersonalDashboardAction(){
  const actor=await currentUser();await prisma.userDashboardLayout.deleteMany({where:{userId:actor.id}});revalidatePath('/');redirect('/?saved=dashboard-reset');
}

export async function saveRoleDashboardAction(role:UserRole,_state:DashboardActionState,form:FormData):Promise<DashboardActionState>{
  const admin=await requireMutation('configuration.manage');
  try{
    const target={id:admin.id,role,active:true,archivedAt:null};
    const submitted=await validateDashboardLayout(prisma,target,parse(form),{roleDefault:true});
    const configuration=await validateDashboardLayout(prisma,target,await preserveUnavailableItems(await getRoleDashboardLayout(prisma,target),submitted),{roleDefault:true});
    await prisma.roleDashboardLayout.upsert({where:{role},create:{role,configuration:configuration as unknown as Prisma.InputJsonValue,updatedById:admin.id},update:{configuration:configuration as unknown as Prisma.InputJsonValue,updatedById:admin.id}});
  }catch(error){return {message:error instanceof Error?error.message:'Could not save Dashboard default.'};}
  revalidatePath('/');revalidatePath('/administration/dashboard-views');redirect(`/administration/dashboard-views?role=${role}&saved=role-default`);
}

export async function restoreSystemDashboardAction(form:FormData){
  await requireMutation('configuration.manage');const role=String(form.get('role')??'') as UserRole;
  if(!Object.hasOwn(systemDashboardDefaults,role))throw new Error('Unknown role.');
  await prisma.roleDashboardLayout.deleteMany({where:{role}});revalidatePath('/');revalidatePath('/administration/dashboard-views');redirect(`/administration/dashboard-views?role=${role}&saved=system-default`);
}

export async function addReportToDashboardAction(form:FormData){
  const actor=await currentUser(),reportId=Number(form.get('reportId'));
  if(!Number.isSafeInteger(reportId)||reportId<1)throw new Error('Saved Report is invalid.');
  const report=await prisma.reportDefinition.findUnique({where:{id:reportId},select:{reportType:true}});
  if(!report||!reportTypeAvailable(report.reportType,await getModuleAvailability()))throw new Error('Report unavailable.');
  const effective=await getEffectiveDashboardLayout(prisma,actor);
  if(!effective.configuration.items.some(item=>item.kind==='SAVED_REPORT'&&item.reportId===reportId)){
    const configuration:DashboardLayoutConfiguration={version:1,items:[...effective.configuration.items,{kind:'SAVED_REPORT',reportId,size:'HALF',style:'KPI'}]};
    const valid=await validateDashboardLayout(prisma,actor,configuration);
    await prisma.userDashboardLayout.upsert({where:{userId:actor.id},create:{userId:actor.id,role:actor.role,configuration:valid as unknown as Prisma.InputJsonValue},update:{role:actor.role,configuration:valid as unknown as Prisma.InputJsonValue}});
  }
  revalidatePath('/');redirect(`/reports/${reportId}?saved=dashboard`);
}
