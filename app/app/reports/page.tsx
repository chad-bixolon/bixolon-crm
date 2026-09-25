import Link from 'next/link';
import { restoreReportAction } from './actions';
import { notFound } from 'next/navigation';
import { Content, PageHeader } from '@/components/shell';
import { currentUser } from '@/lib/current-user';
import { prisma } from '@/lib/prisma';
import { canAccessReports, canEditReportDefinition, getCreatableReportTypes, getVisibleBuiltInReports, getVisibleReportTypes, reportRegistry, savedReportWhere, type BuiltInReportType } from '@/lib/reporting';

export const dynamic = 'force-dynamic';

type BuiltInCard = {
  id: BuiltInReportType;
  title: string;
  description: string;
  href: string | ((actorId: number) => string);
};

const builtInGroups: { title: string; cards: BuiltInCard[] }[] = [
  {
    title: 'Trade Shows',
    cards: [
      { id: 'TRADE_SHOW_CURRENT_YEAR', title: 'Trade Show Performance — Current Year', description: 'Current-year leads, conversions, pipeline, and won outcomes.', href: '/reports/trade-shows?configured=1&showDatePreset=THIS_YEAR&groupBy=tradeShow' },
      { id: 'LEADS_BY_TRADE_SHOW', title: 'Leads by Trade Show', description: 'Compare lead follow-up and conversion across events.', href: '/reports/trade-shows?configured=1&groupBy=tradeShow' },
      { id: 'LEADS_BY_SALES_REP', title: 'Leads by Sales Rep', description: 'Compare assigned leads and outcomes by sales rep.', href: '/reports/trade-shows?configured=1&groupBy=assignedRep' },
      { id: 'LEADS_BY_ROUTING', title: 'Leads by Routing', description: 'Compare direct Sales, partner referral, Marketing, and unreviewed leads.', href: '/reports/trade-shows?configured=1&groupBy=routing' },
      { id: 'TRADE_SHOW_CONVERSION_FUNNEL', title: 'Trade Show Conversion Funnel', description: 'Review contacted, qualified, converted, and disqualified lead counts.', href: '/reports/trade-shows?configured=1&groupBy=leadStatus&metrics=totalLeads&metrics=contactedLeads&metrics=qualifiedLeads&metrics=convertedLeads&metrics=disqualifiedLeads&metrics=conversionRate' },
      { id: 'TRADE_SHOW_PIPELINE', title: 'Trade Show Pipeline', description: 'Pipeline, weighted pipeline, commit, and wins attributed to event conversions.', href: '/reports/trade-shows?configured=1&groupBy=tradeShow&metrics=opportunityCount&metrics=pipeline&metrics=weightedPipeline&metrics=commit&metrics=closedWonValue&metrics=closedWonOpportunityCount' },
      { id: 'TRADE_SHOW_FOLLOW_UP_NEEDED', title: 'Trade Show Follow-Up Needed', description: 'Open leads whose follow-up date is overdue.', href: '/reports/trade-shows?configured=1&followUpStatus=OVERDUE&groupBy=assignedRep' },
    ],
  },
  {
    title: 'Pipeline & Forecast',
    cards: [
      { id: 'MY_OPEN_PIPELINE', title: 'My Open Pipeline', description: 'Your open Opportunities.', href: actorId => `/reports/new?configured=1&status=OPEN&ownerId=${actorId}&metrics=pipeline&metrics=weightedPipeline&metrics=opportunityCount&columns=opportunity&columns=account&columns=owner&columns=stage&columns=closeDate&columns=value&columns=weightedValue&columns=currency` },
      { id: 'PIPELINE_THIS_QUARTER', title: 'Pipeline This Quarter', description: 'Open Opportunities expected to close this quarter.', href: '/reports/new?configured=1&status=OPEN&closeDatePreset=THIS_QUARTER&groupBy=stage&metrics=pipeline&metrics=opportunityCount&columns=opportunity&columns=account&columns=owner&columns=stage&columns=closeDate&columns=value&columns=currency' },
      { id: 'PIPELINE_BY_SALES_REP', title: 'Pipeline by Sales Rep', description: 'Compare pipeline across the sales team.', href: '/reports/new?configured=1&status=OPEN&groupBy=owner&metrics=pipeline&metrics=opportunityCount&columns=opportunity&columns=account&columns=owner&columns=stage&columns=closeDate&columns=value&columns=currency' },
    ],
  },
  {
    title: 'Product & Partner',
    cards: [
      { id: 'PRODUCT_THIS_QUARTER', title: 'Product Performance This Quarter', description: 'Product lines expected to close this quarter.', href: '/reports/new?reportType=PRODUCT_PERFORMANCE&configured=1&status=OPEN&closeDatePreset=THIS_QUARTER&groupBy=productCategory&metrics=lineValue&metrics=quantity&metrics=opportunityCount' },
      { id: 'PIPELINE_BY_PRODUCT', title: 'Pipeline by Product', description: 'Open pipeline by product or model.', href: '/reports/new?reportType=PRODUCT_PERFORMANCE&configured=1&status=OPEN&groupBy=product&metrics=lineValue&metrics=quantity&metrics=opportunityCount' },
      { id: 'PIPELINE_BY_PARTNER', title: 'Pipeline by Partner', description: 'Open Opportunities by participating partner.', href: '/reports/new?reportType=CHANNEL_PARTNER&configured=1&status=OPEN&groupBy=partner' },
      { id: 'PIPELINE_BY_PARTNER_TYPE', title: 'Pipeline by Partner Type', description: 'Open Opportunities by partner role.', href: '/reports/new?reportType=CHANNEL_PARTNER&configured=1&status=OPEN&groupBy=participantRole' },
      { id: 'MEDIA_PARTNER_PIPELINE', title: 'Media Partner Pipeline', description: 'Open Opportunities involving Media Partners.', href: '/reports/new?reportType=CHANNEL_PARTNER&configured=1&status=OPEN&participantRole=MEDIA_PARTNER&groupBy=partner' },
    ],
  },
  {
    title: 'Projects',
    cards: [
      { id: 'ACTIVE_PROJECTS', title: 'Active Projects', description: 'Active Projects and their open Opportunities.', href: '/reports/new?reportType=PROJECT_INITIATIVE&configured=1&projectStatus=ACTIVE&status=OPEN&groupBy=project' },
      { id: 'PIPELINE_BY_PROJECT', title: 'Pipeline by Project', description: 'Open pipeline by Project.', href: '/reports/new?reportType=PROJECT_INITIATIVE&configured=1&status=OPEN&groupBy=project' },
      { id: 'PROJECTS_NEAR_TARGET', title: 'Projects Near Target Date', description: 'Active Projects due within 30 days.', href: '/reports/new?reportType=PROJECT_INITIATIVE&configured=1&projectStatus=ACTIVE&status=OPEN&targetEndDatePreset=NEXT_30_DAYS&groupBy=project' },
    ],
  },
  {
    title: 'Price Exceptions',
    cards: [
      { id: 'PE_USAGE_THIS_QUARTER', title: 'PE Usage This Quarter', description: 'Opportunity product lines using Price Exception pricing and expected to close this quarter.', href: '/reports/new?reportType=PRICE_EXCEPTION_USAGE&configured=1&closeDatePreset=THIS_QUARTER&groupBy=priceException' },
      { id: 'PE_USAGE_BY_SALES_REP', title: 'PE Usage by Sales Rep', description: 'Compare Price Exception usage across the sales team.', href: '/reports/new?reportType=PRICE_EXCEPTION_USAGE&configured=1&groupBy=owner&metrics=lineValue&metrics=quantity&metrics=opportunityCount&metrics=priceExceptionCount' },
      { id: 'PE_USAGE_BY_PRODUCT', title: 'PE Usage by Product', description: 'Compare quantity, line value, and approved prices by product.', href: '/reports/new?reportType=PRICE_EXCEPTION_USAGE&configured=1&groupBy=product&metrics=quantity&metrics=lineValue&metrics=opportunityCount&metrics=averageApprovedUnitPrice&metrics=averageActualUnitPrice' },
      { id: 'PRICE_OVERRIDES', title: 'Price Overrides', description: 'Opportunity lines priced differently from their PE Approved Price.', href: '/reports/new?reportType=PRICE_EXCEPTION_USAGE&configured=1&overrideStatus=APPLIED&groupBy=priceException' },
      { id: 'PES_BELOW_MOQ', title: 'PE Usage Below MOQ', description: 'Opportunity lines with quantity below the saved Price Exception MOQ.', href: '/reports/new?reportType=PRICE_EXCEPTION_USAGE&configured=1&moqStatus=NOT_MET&groupBy=priceException' },
    ],
  },
  {
    title: 'Account Follow-Up',
    cards: [
      { id: 'ACCOUNT_ENGAGEMENT', title: 'Accounts With No Activity 30+ Days', description: 'Accounts with no recorded activity in the last 30 days.', href: '/reports/new?reportType=ACCOUNT_ACTIVITY&configured=1&minDays=30' },
    ],
  },
];

export default async function ReportsPage({searchParams}:{searchParams:Promise<{view?:string}>}) {
  const actor = await currentUser();
  const archivedView=(await searchParams).view==='archived';
  if (!canAccessReports(actor)) notFound();
  const builtIns = new Set(getVisibleBuiltInReports(actor));
  const visibleReportTypes = getVisibleReportTypes(actor);
  const creatableReportTypes = getCreatableReportTypes(actor);
  const reports = await prisma.reportDefinition.findMany({ where: {...savedReportWhere(actor),archivedAt:archivedView?{not:null}:null}, include: { owner: true }, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }] });
  const mine = reports.filter(report => report.ownerId === actor.id);
  const shared = reports.filter(report => report.visibility === 'SHARED' && report.ownerId !== actor.id);

  return <Content>
    <PageHeader eyebrow="Management reporting" title="Reports" description="Create, save, and review reports using current SalesHub data." action={creatableReportTypes.length ? <Link className="btn-primary" href={creatableReportTypes.includes('PIPELINE')?'/reports/new':'/reports/new?reportType=TRADE_SHOW'}>Create Report</Link> : undefined} />
    {visibleReportTypes.includes('PIPELINE')&&<section className="-mt-1 mb-6">
      <Link className="group flex flex-col gap-3 rounded-lg border border-orange-200 bg-orange-50/70 p-4 transition-colors hover:border-orange-400 hover:bg-orange-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600 sm:flex-row sm:items-center sm:justify-between" href="/reports/forecast">
        <div className="min-w-0"><h2 className="text-lg font-semibold text-slate-950">Quarterly Forecast</h2><p className="mt-1 text-sm leading-6 text-slate-600">View targets, open pipeline, commit, and coverage by sales rep and currency.</p></div>
        <span className="shrink-0 text-sm font-semibold text-orange-800">View forecast <span aria-hidden="true">→</span></span>
      </Link>
    </section>}
    {!!builtIns.size && <section className="panel mb-8 p-5 md:p-6">
      <h2 className="text-lg font-semibold">Built-in Reports</h2>
      <p className="mt-1 text-sm text-slate-600">Open common report views instantly.</p>
      <div className="mt-5 space-y-6">
        {builtInGroups.map(group => {
          const cards = group.cards.filter(card => builtIns.has(card.id));
          if (!cards.length) return null;
          return <section key={group.title} aria-label={group.title} className="border-t border-slate-100 pt-5 first:border-0 first:pt-0">
            <h3 className="mb-3 text-base font-semibold text-slate-900">{group.title}</h3>
            <div className="grid auto-rows-fr gap-3 sm:grid-cols-2">
              {cards.map(card => <Link key={card.id} className="flex h-full min-w-0 flex-col rounded-md border border-slate-200 bg-white p-4 transition-colors hover:border-orange-400 hover:bg-orange-50/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600" href={typeof card.href === 'function' ? card.href(actor.id) : card.href}>
                <strong className="block min-h-12 text-sm leading-6">{card.title}</strong>
                <span className="block text-sm leading-5 text-slate-600">{card.description}</span>
              </Link>)}
            </div>
          </section>;
        })}
      </div>
    </section>}
    <section className="mb-8"><h2 className="text-lg font-semibold">Saved Reports</h2><nav className="mt-2 flex gap-4 text-sm"><Link className={!archivedView?'font-semibold text-orange-800':'underline'} href="/reports">Current</Link><Link className={archivedView?'font-semibold text-orange-800':'underline'} href="/reports?view=archived">Archived</Link></nav><p className="mt-1 text-sm text-slate-600">Open reports you&apos;ve saved or reports shared with your team.</p><div className="mt-4 grid items-stretch gap-4 lg:grid-cols-2">{[{title:'My Reports',help:'Reports you\'ve saved for reuse.',list:mine},{title:'Shared Reports',help:'Reports shared with your team.',list:shared}].map(({title,help,list})=><section className="panel flex min-w-0 flex-col" key={title}><div className="border-b border-slate-200 p-5"><h3 className="text-base font-semibold">{title}</h3><p className="mt-1 text-sm leading-5 text-slate-600">{help}</p></div>{list.length?<ul className="divide-y divide-slate-100">{list.map(report=><li className="p-5" key={report.id}><Link className="font-medium text-orange-800 underline" href={`/reports/${report.id}`}>{report.name}</Link>{archivedView&&canEditReportDefinition(actor,report)&&<form action={restoreReportAction} className="mt-2"><input type="hidden" name="reportId" value={report.id}/><button className="text-sm text-orange-800 underline">Restore</button></form>}<p className="mt-1 text-sm leading-5 text-slate-600">{reportRegistry[report.reportType].label} · {report.visibility==='PERSONAL'?'Personal':`Shared by ${report.owner.firstName} ${report.owner.lastName}`} · updated {report.updatedAt.toISOString().slice(0,10)}</p></li>)}</ul>:<p className="flex flex-1 items-center p-5 text-sm text-slate-500">No reports yet.</p>}</section>)}</div></section>
    {!!visibleReportTypes.length&&<section className="border-t border-slate-200 pt-7"><h2 className="text-lg font-semibold">Report Types</h2><p className="mt-1 text-sm text-slate-600">Create a new report from an available template.</p><div className="mt-4 grid auto-rows-fr gap-3 sm:grid-cols-2 xl:grid-cols-3">{visibleReportTypes.map(reportType=>{const definition=reportRegistry[reportType];return <div className="flex h-full min-w-0 flex-col rounded-md border border-slate-200 bg-slate-50/70 p-4" key={reportType}><p className="text-sm font-semibold leading-6 text-slate-800">{definition.label}</p><p className="mt-1 text-sm leading-5 text-slate-600">{definition.description}</p></div>;})}</div></section>}
  </Content>;
}
