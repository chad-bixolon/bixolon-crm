import Link from 'next/link';
import type { Actor } from '@/lib/authorization';
import { Content,PageHeader } from '@/components/shell';
import { ReportResults } from '@/components/report-results';
import { prisma } from '@/lib/prisma';
import { accountActivityConfigFromParams,filterValue } from '@/lib/report-builder';
import { canShareReport,executeAccountActivityReport,reportRegistry } from '@/lib/reporting';
import { saveReportAction } from '../actions';

type Params=Record<string,string|string[]|undefined>;
type Saved={id:number;name:string;description:string|null;visibility:'PERSONAL'|'SHARED';configuration:unknown}|null;
export async function AccountActivityBuilder({params,actor,saved}:{params:Params;actor:Actor;saved:Saved}) {
 const config=accountActivityConfigFromParams(params,saved?.configuration);
 const [result,owners,accounts,industries,territories,types]=await Promise.all([
  executeAccountActivityReport(prisma,actor,config),
  prisma.user.findMany({where:{active:true,archivedAt:null,...(actor.role==='SALES'?{id:actor.id}:{})},orderBy:[{lastName:'asc'},{firstName:'asc'}]}),
  prisma.account.findMany({where:{archivedAt:null,status:'ACTIVE',...(actor.role==='SALES'?{ownerId:actor.id}:{})},select:{id:true,name:true},orderBy:{name:'asc'}}),
  prisma.industry.findMany({orderBy:{name:'asc'}}),prisma.territory.findMany({orderBy:{name:'asc'}}),
  prisma.activityType.findMany({orderBy:[{sortOrder:'asc'},{name:'asc'}]})
 ]);
 const selected=(field:string)=>String(filterValue(config,field)??'');
 const definition=reportRegistry.ACCOUNT_ACTIVITY;
 return <Content><PageHeader eyebrow="Reports" title={saved?'Edit Account Activity Report':'Account Activity Report'} description="Find Accounts that need attention using current Activity records." action={<Link className="btn-secondary" href="/reports">Reports</Link>}/>
 <div className="mb-2 flex flex-wrap gap-2"><Link className="btn-secondary" href="/reports/new?reportType=PIPELINE">Pipeline</Link><Link className="btn-secondary" href="/reports/new?reportType=ACCOUNT_ACTIVITY">Account Activity</Link><Link className="btn-secondary" href="/reports/new?reportType=PRODUCT_PERFORMANCE">Product Performance</Link></div><form method="get" className="panel report-builder p-3 md:p-4"><input type="hidden" name="configured" value="1"/><input type="hidden" name="reportType" value="ACCOUNT_ACTIVITY"/>{saved&&<input type="hidden" name="reportId" value={saved.id}/>}
 <fieldset className="report-section report-primary-filters"><legend className="report-section-title">Account filters</legend><div className="report-filter-grid">
 <label className="label">Sales Rep<select className="field" name="ownerId" defaultValue={selected('ownerId')}><option value="">All permitted</option>{owners.map(x=><option key={x.id} value={x.id}>{x.firstName} {x.lastName}</option>)}</select></label>
 <label className="label">Account<select className="field" name="accountId" defaultValue={selected('accountId')}><option value="">All</option>{accounts.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
 <label className="label">Industry<select className="field" name="industry" defaultValue={selected('industry')}><option value="">All</option>{industries.map(x=><option key={x.code} value={x.code}>{x.name}</option>)}</select></label>
 <label className="label">Territory<select className="field" name="territory" defaultValue={selected('territory')}><option value="">All</option>{territories.map(x=><option key={x.code} value={x.code}>{x.name}</option>)}</select></label>
 <label className="label">Business Role<select className="field" name="businessRole" defaultValue={selected('businessRole')}><option value="">All</option>{['END_USER','DISTRIBUTOR','VAR','ISV','OEM','PARTNER','MEDIA_PARTNER'].map(x=><option key={x} value={x}>{x.replaceAll('_',' ')}</option>)}</select></label>
 <label className="label">Strategic Account<select className="field" name="strategicAccount" defaultValue={selected('strategicAccount')}><option value="">All</option><option value="true">Yes</option><option value="false">No</option></select></label>
 </div></fieldset>
 <fieldset className="report-section"><legend className="report-section-title">Activity filters</legend><div className="report-filter-grid">
 <label className="label">Latest Activity Type<select className="field" name="activityType" defaultValue={selected('activityType')}><option value="">All</option>{types.map(x=><option key={x.code} value={x.code}>{x.name}{x.active?'':' (inactive)'}</option>)}</select></label>
 <label className="label">Activity status<select className="field" name="hasActivity" defaultValue={selected('hasActivity')}><option value="">Any</option><option value="true">Has activity</option><option value="false">No activity</option></select></label>
 <label className="label">No activity in at least N days<input className="field report-days-input" type="number" min="1" name="minDays" defaultValue={selected('minDays')}/></label>
 </div></fieldset>
 <fieldset className="report-section"><legend className="report-section-title">Display options</legend><div className="report-filter-grid">
 <label className="label">Group By<select className="field" name="groupBy" defaultValue={config.groupBy??''}><option value="">None</option>{Object.entries(definition.groupings).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
 <label className="label">Sort<select className="field" name="sortField" defaultValue={config.sort[0]?.field??'lastActivity'}>{Object.entries(definition.sorts).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
 <label className="label">Direction<select className="field" name="sortDirection" defaultValue={config.sort[0]?.direction??'asc'}><option value="asc">Ascending</option><option value="desc">Descending</option></select></label></div></fieldset>
 <fieldset className="report-metrics"><legend className="report-metrics-title">Metrics</legend><div className="report-options">{Object.entries(definition.metrics).map(([value,label])=><label key={value} className="text-sm"><input className="mr-2" type="checkbox" name="metrics" value={value} defaultChecked={config.metrics.includes(value)}/>{label}</label>)}</div></fieldset>
 <fieldset className="report-columns"><legend className="report-columns-title">Detail columns</legend><div className="report-options">{Object.entries(definition.columns).map(([value,label])=><label key={value} className="text-sm"><input className="mr-2" type="checkbox" name="columns" value={value} defaultChecked={config.columns.includes(value)}/>{label}</label>)}</div></fieldset>
 <div className="report-preview"><button className="btn-primary">Preview</button></div></form>
 <ReportResults result={result} config={config} groupKey={typeof params.group==='string'?params.group:undefined}/>
 <form action={saveReportAction} className="panel mt-4 grid gap-3 p-4 sm:grid-cols-2 md:p-5"><h2 className="text-lg font-semibold sm:col-span-2">Save This Report</h2><input type="hidden" name="reportType" value="ACCOUNT_ACTIVITY"/><input type="hidden" name="configuration" value={JSON.stringify(config)}/>{saved&&<input type="hidden" name="reportId" value={saved.id}/>}
 <label className="label">Report name<input className="field" name="name" required maxLength={120} defaultValue={saved?.name??''}/></label><label className="label">Visibility<select className="field" name="visibility" defaultValue={saved?.visibility??'PERSONAL'}><option value="PERSONAL">Personal</option>{canShareReport(actor)&&<option value="SHARED">Shared</option>}</select></label><label className="label sm:col-span-2">Description<textarea className="field" name="description" maxLength={1000} defaultValue={saved?.description??''}/></label><div><button className="btn-primary">{saved?'Save changes':'Save report'}</button></div></form></Content>;
}
