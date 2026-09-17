import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { pipelineTotalsByCurrency } from '@/lib/analytics';
import { formatCurrency } from '@/lib/display-format';
import { Content, PageHeader } from '@/components/shell';
import { dayBounds, dashboardOpenTaskWhere } from '@/lib/work';
import { getSettings, getLabels } from '@/lib/configuration';
export const dynamic = 'force-dynamic';
export default async function HomePage() {
  const {start,end}=dayBounds(); const open=dashboardOpenTaskWhere();
  const [settings, labels] = await Promise.all([getSettings(prisma), getLabels(prisma)]);
  const staleBefore = new Date(start.getTime() - settings.STALE_ACCOUNT_WARNING_DAYS * 86400000);
  const activityFrom = new Date(start.getTime() - settings.ACTIVITY_LOOKBACK_DAYS * 86400000);
  const [active,strategic,opportunities,openTasks,overdue,dueToday,recentActivities,recentOpportunities,staleAccounts]=await Promise.all([
    prisma.account.count({where:{status:'ACTIVE'}}),prisma.account.count({where:{status:'ACTIVE',strategicAccount:true}}),
    prisma.opportunity.findMany({where:{archivedAt:null,stage:{isClosed:false}},include:{stage:true,products:{where:{archivedAt:null}}}}),
    prisma.task.count({where:open}),prisma.task.count({where:{...open,dueDate:{lt:start}}}),prisma.task.count({where:{...open,dueDate:{gte:start,lt:end}}}),
    prisma.activity.findMany({where:{archivedAt:null,activityDate:{gte:activityFrom}},include:{activityType:true},orderBy:[{activityDate:'desc'},{id:'desc'}],take:5}),
    prisma.opportunity.findMany({where:{archivedAt:null},include:{stage:true},orderBy:[{updatedAt:'desc'},{id:'desc'}],take:5}),
    prisma.account.count({where:{status:'ACTIVE',updatedAt:{lt:staleBefore}}}),
  ]);
  const pipeline = pipelineTotalsByCurrency(opportunities);
  const metrics=[[`Active ${labels.ACCOUNT.toLowerCase()}s`,active],[labels.STRATEGIC_ACCOUNT + 's',strategic],[`Open ${labels.OPPORTUNITY.toLowerCase()}s`,opportunities.length],['Open tasks',openTasks],['Overdue tasks',overdue],['Due today',dueToday]] as const;
  return <Content><PageHeader eyebrow="CRM overview" title="Dashboard" description="Current records from the CRM database."/>{staleAccounts > 0 && <p className="mb-5 rounded border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">{staleAccounts} active account{staleAccounts === 1 ? '' : 's'} have not been updated in {settings.STALE_ACCOUNT_WARNING_DAYS} days. <Link className="underline" href="/accounts">Review accounts</Link></p>}<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{metrics.map(([label,value])=><div className="panel p-6" key={label}><p className="text-sm text-slate-600">{label}</p><p className="mt-3 text-3xl font-semibold">{value}</p></div>)}</div><div className="mt-5 grid gap-4 sm:grid-cols-2">{pipeline.map(group=><div className="panel p-6" key={group.currency}><h2 className="font-semibold">{group.currency} pipeline</h2><p className="mt-3">Total open: {formatCurrency(group.estimated, group.currency)}</p><p>Weighted: {formatCurrency(group.weighted, group.currency)}</p></div>)}</div>{!pipeline.length&&<p className="panel mt-5 p-6 text-sm text-slate-500">No open pipeline.</p>}<div className="mt-5 grid gap-5 lg:grid-cols-2"><section className="panel p-6"><h2 className="mb-3 text-lg font-semibold">Recent activities <span className="text-sm font-normal text-slate-500">(last {settings.ACTIVITY_LOOKBACK_DAYS} days)</span></h2>{recentActivities.length?<ul className="divide-y">{recentActivities.map(a=><li className="py-3 text-sm" key={a.id}><Link className="text-orange-800" href={`/activities/${a.id}/edit`}>{a.subject}</Link> · {a.activityType.name} · {a.activityDate.toISOString().slice(0,10)}</li>)}</ul>:<p className="text-sm text-slate-500">No activities in this period.</p>}</section><section className="panel p-6"><h2 className="mb-3 text-lg font-semibold">Recently updated opportunities</h2>{recentOpportunities.length?<ul className="divide-y">{recentOpportunities.map(o=><li className="py-3 text-sm" key={o.id}><Link className="text-orange-800" href={`/opportunities/${o.id}`}>{o.name}</Link> · {o.stage.name} · {o.updatedAt.toISOString().slice(0,10)}</li>)}</ul>:<p className="text-sm text-slate-500">No opportunities yet.</p>}</section></div></Content>;
}
