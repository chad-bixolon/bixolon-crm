import type { UserRole } from '@prisma/client';
import Link from 'next/link';
import { DashboardEditor } from '@/components/dashboard-editor';
import { SaveSuccess } from '@/components/save-success';
import { Content,PageHeader } from '@/components/shell';
import { restoreSystemDashboardAction,saveRoleDashboardAction } from '@/app/dashboard-actions';
import { requirePermission } from '@/lib/current-user';
import { availableDashboardWidgets,getRoleDashboardLayout } from '@/lib/dashboard';
import { prisma } from '@/lib/prisma';
import { roleLabels } from '@/lib/role-labels';

export const dynamic='force-dynamic';
const roles:UserRole[]=['ADMIN','SALES_MANAGER','SALES','MARKETING_MANAGER','READ_ONLY'];
export default async function DashboardViewsPage({searchParams}:{searchParams:Promise<{role?:string;saved?:string}>}){
  const admin=await requirePermission('users.manage'),params=await searchParams;
  const role=roles.includes(params.role as UserRole)?params.role as UserRole:'SALES_MANAGER';
  const target={id:admin.id,role,active:true,archivedAt:null};
  const configuration=await getRoleDashboardLayout(prisma,target);
  const feedback=params.saved==='role-default'?`${roleLabels[role]} Dashboard default updated.`:params.saved==='system-default'?`${roleLabels[role]} Dashboard restored to the system default.`:null;
  return <Content><PageHeader eyebrow="Administration" title="Dashboard Views" description="Configure the role default inherited by users who have not personalized their Dashboard." action={<Link className="btn-secondary" href="/administration">Administration</Link>}/>{feedback&&<SaveSuccess message={feedback}/>}<form className="panel mb-5 flex flex-wrap items-end gap-3 p-4" method="get"><label className="label min-w-64">Dashboard View<select className="field mt-1" name="role" defaultValue={role}>{roles.map(value=><option value={value} key={value}>{roleLabels[value]}</option>)}</select></label><button className="btn-secondary">View</button><p className="w-full text-sm text-slate-600">Configure the default Dashboard shown to {roleLabels[role]} users.</p></form><DashboardEditor initial={configuration} widgets={availableDashboardWidgets(target)} action={saveRoleDashboardAction.bind(null,role)} cancelHref="/administration" submitLabel="Save Default" allowReports={false}/><form action={restoreSystemDashboardAction} className="mt-3"><input type="hidden" name="role" value={role}/><button className="text-sm font-semibold text-orange-800 underline">Restore System Default</button></form></Content>;
}
