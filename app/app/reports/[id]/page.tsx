import Link from 'next/link';
import { notFound } from 'next/navigation';
import { addReportToDashboardAction } from '@/app/dashboard-actions';
import { Content,PageHeader } from '@/components/shell';
import { ReportResults } from '@/components/report-results';
import { SaveSuccess } from '@/components/save-success';
import { currentUser } from '@/lib/current-user';
import { getEffectiveDashboardLayout } from '@/lib/dashboard';
import { prisma } from '@/lib/prisma';
import { canCreateReport,canEditReportDefinition,canViewReportDefinition,executeReport,reportRegistry,validateReportConfiguration } from '@/lib/reporting';
import { archiveReportAction,duplicateReportAction } from '../actions';

export const dynamic='force-dynamic';
export default async function SavedReportPage({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<{group?:string;saved?:string}>}){
  const actor=await currentUser(),id=Number((await params).id),query=await searchParams;
  if(!Number.isSafeInteger(id)||id<1)notFound();
  const report=await prisma.reportDefinition.findUnique({where:{id},include:{owner:true}});
  if(!report||!canViewReportDefinition(actor,report))notFound();
  const config=validateReportConfiguration(report.reportType,report.configuration),result=await executeReport(prisma,actor,report.reportType,config),editable=canEditReportDefinition(actor,report);
  const dashboard=await getEffectiveDashboardLayout(prisma,actor),pinned=dashboard.configuration.items.some(item=>item.kind==='SAVED_REPORT'&&item.reportId===id);
  return <Content><PageHeader eyebrow={`${reportRegistry[report.reportType].label} · ${report.visibility}`} title={report.name} description={report.description??'Saved report re-run against current CRM data.'} action={<div className="flex flex-wrap gap-2"><Link className="btn-secondary" href="/reports">Reports</Link>{pinned?<Link className="btn-secondary" href="/?customize=1">Manage Dashboard</Link>:<form action={addReportToDashboardAction}><input type="hidden" name="reportId" value={report.id}/><button className="btn-secondary">Add to Dashboard</button></form>}{editable&&<Link className="btn-primary" href={`/reports/new?reportId=${report.id}`}>Edit</Link>}</div>}/>{query.saved==='dashboard'&&<SaveSuccess message="Report added to your Dashboard." action={{href:'/',label:'View Dashboard'}}/>}<p className="mb-4 text-sm text-slate-600">Owned by {report.owner.firstName} {report.owner.lastName} · updated {report.updatedAt.toISOString().slice(0,16).replace('T',' ')} UTC</p><ReportResults result={result} config={config} groupKey={query.group}/><div className="mt-5 flex gap-3">{canCreateReport(actor)&&<form action={duplicateReportAction}><input type="hidden" name="reportId" value={report.id}/><button className="btn-secondary">Duplicate as personal</button></form>}{editable&&<form action={archiveReportAction}><input type="hidden" name="reportId" value={report.id}/><button className="btn-secondary">Archive</button></form>}</div></Content>;
}
