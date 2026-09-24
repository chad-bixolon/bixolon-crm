'use server';

import type { Prisma, UserRole } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { currentUser, requireMutation } from '@/lib/current-user';
import { getEffectiveDashboardLayout, systemDashboardDefaults, validateDashboardLayout, type DashboardLayoutConfiguration } from '@/lib/dashboard';
import { prisma } from '@/lib/prisma';

export type DashboardActionState={message:string};
const parse=(form:FormData)=>JSON.parse(String(form.get('configuration')??'null')) as unknown;

export async function savePersonalDashboardAction(_state:DashboardActionState,form:FormData):Promise<DashboardActionState>{
  const actor=await currentUser();
  try{
    const configuration=await validateDashboardLayout(prisma,actor,parse(form));
    await prisma.userDashboardLayout.upsert({where:{userId:actor.id},create:{userId:actor.id,role:actor.role,configuration:configuration as unknown as Prisma.InputJsonValue},update:{role:actor.role,configuration:configuration as unknown as Prisma.InputJsonValue}});
  }catch(error){return {message:error instanceof Error?error.message:'Could not save Dashboard.'};}
  revalidatePath('/');redirect('/?saved=dashboard');
}

export async function resetPersonalDashboardAction(){
  const actor=await currentUser();await prisma.userDashboardLayout.deleteMany({where:{userId:actor.id}});revalidatePath('/');redirect('/?saved=dashboard-reset');
}

export async function saveRoleDashboardAction(role:UserRole,_state:DashboardActionState,form:FormData):Promise<DashboardActionState>{
  const admin=await requireMutation('users.manage');
  try{
    const target={id:admin.id,role,active:true,archivedAt:null};
    const configuration=await validateDashboardLayout(prisma,target,parse(form),{roleDefault:true});
    await prisma.roleDashboardLayout.upsert({where:{role},create:{role,configuration:configuration as unknown as Prisma.InputJsonValue,updatedById:admin.id},update:{configuration:configuration as unknown as Prisma.InputJsonValue,updatedById:admin.id}});
  }catch(error){return {message:error instanceof Error?error.message:'Could not save Dashboard default.'};}
  revalidatePath('/');revalidatePath('/administration/dashboard-views');redirect(`/administration/dashboard-views?role=${role}&saved=role-default`);
}

export async function restoreSystemDashboardAction(form:FormData){
  await requireMutation('users.manage');const role=String(form.get('role')??'') as UserRole;
  if(!Object.hasOwn(systemDashboardDefaults,role))throw new Error('Unknown role.');
  await prisma.roleDashboardLayout.deleteMany({where:{role}});revalidatePath('/');revalidatePath('/administration/dashboard-views');redirect(`/administration/dashboard-views?role=${role}&saved=system-default`);
}

export async function addReportToDashboardAction(form:FormData){
  const actor=await currentUser(),reportId=Number(form.get('reportId'));
  if(!Number.isSafeInteger(reportId)||reportId<1)throw new Error('Saved Report is invalid.');
  const effective=await getEffectiveDashboardLayout(prisma,actor);
  if(!effective.configuration.items.some(item=>item.kind==='SAVED_REPORT'&&item.reportId===reportId)){
    const configuration:DashboardLayoutConfiguration={version:1,items:[...effective.configuration.items,{kind:'SAVED_REPORT',reportId,size:'HALF',style:'KPI'}]};
    const valid=await validateDashboardLayout(prisma,actor,configuration);
    await prisma.userDashboardLayout.upsert({where:{userId:actor.id},create:{userId:actor.id,role:actor.role,configuration:valid as unknown as Prisma.InputJsonValue},update:{role:actor.role,configuration:valid as unknown as Prisma.InputJsonValue}});
  }
  revalidatePath('/');redirect(`/reports/${reportId}?saved=dashboard`);
}
