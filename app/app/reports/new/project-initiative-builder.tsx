import Link from 'next/link';
import type {Actor} from '@/lib/authorization';
import {Content,PageHeader} from '@/components/shell';
import {ReportResults} from '@/components/report-results';
import {prisma} from '@/lib/prisma';
import {projectInitiativeConfigFromParams,filterValue} from '@/lib/report-builder';
import {canShareReport,executeProjectInitiativeReport,reportRegistry} from '@/lib/reporting';
import {projectStatusLabels} from '@/lib/project-labels';
import {projectReadWhere} from '@/lib/projects';
import {saveReportAction} from '../actions';

type Params=Record<string,string|string[]|undefined>;
type Saved={id:number;name:string;description:string|null;visibility:'PERSONAL'|'SHARED';configuration:unknown}|null;
export async function ProjectInitiativeBuilder({params,actor,saved}:{params:Params;actor:Actor;saved:Saved}){
  const config=projectInitiativeConfigFromParams(params,saved?.configuration),definition=reportRegistry.PROJECT_INITIATIVE;
  const [result,owners,projects,accounts,stages,categories,currencies]=await Promise.all([
    executeProjectInitiativeReport(prisma,actor,config),
    prisma.user.findMany({where:{active:true,archivedAt:null},orderBy:[{lastName:'asc'},{firstName:'asc'}]}),
    prisma.project.findMany({where:{AND:[{archivedAt:null},projectReadWhere(actor)]},select:{id:true,name:true},orderBy:{name:'asc'}}),
    prisma.account.findMany({where:{archivedAt:null},select:{id:true,name:true},orderBy:{name:'asc'}}),
    prisma.salesStage.findMany({orderBy:[{sortOrder:'asc'},{id:'asc'}]}),
    prisma.productCategory.findMany({where:{active:true},orderBy:{name:'asc'}}),
    prisma.currency.findMany({where:{active:true},orderBy:{code:'asc'}}),
  ]);
  const selected=(field:string)=>String(filterValue(config,field)??'');
  const select=(name:string,label:string,items:{value:string|number;label:string}[],empty='All')=><label className="label">{label}<select className="field" name={name} defaultValue={selected(name)}><option value="">{empty}</option>{items.map(item=><option key={item.value} value={item.value}>{item.label}</option>)}</select></label>;
  const date=(field:'startDate'|'targetEndDate'|'closeDate',label:string)=>{const filter=config.filters.find(f=>f.field===field),choice=filter?.operator==='attention'||filter?.operator==='preset'?String(filter.value):filter?.operator==='between'?'CUSTOM':'ANY',range=filter?.operator==='between'?filter.value as {from:string;to:string}:null;return <fieldset className="label"><legend>{label}</legend><select className="field" name={`${field}Preset`} defaultValue={choice}><option value="ANY">Any date</option><option value="THIS_MONTH">This Month</option><option value="THIS_QUARTER">This Quarter</option><option value="THIS_YEAR">This Year</option>{field==='targetEndDate'&&<><option value="OVERDUE">Overdue, still active</option><option value="NEXT_30_DAYS">Next 30 Days</option><option value="NO_DATE">No Target End Date</option></>}<option value="CUSTOM">Custom range</option></select><div className="mt-1 flex gap-1"><input className="field min-w-0" aria-label={`${label} from`} type="date" name={`${field}From`} defaultValue={range?.from}/><input className="field min-w-0" aria-label={`${label} to`} type="date" name={`${field}To`} defaultValue={range?.to}/></div></fieldset>;};
  return <Content><PageHeader eyebrow="Reports" title={saved?'Edit Project Report':'Project Report'} description="Review Projects, linked Opportunities, and associated pipeline." action={<Link className="btn-secondary" href="/reports">Reports</Link>}/>
    <div className="mb-2 flex flex-wrap gap-2"><Link className="btn-secondary" href="/reports/new?reportType=PIPELINE">Pipeline</Link><Link className="btn-secondary" href="/reports/new?reportType=ACCOUNT_ACTIVITY">Account Activity</Link><Link className="btn-secondary" href="/reports/new?reportType=PRODUCT_PERFORMANCE">Product Performance</Link><Link className="btn-secondary" href="/reports/new?reportType=CHANNEL_PARTNER">Channel / Partner</Link><Link className="btn-secondary" href="/reports/new?reportType=PROJECT_INITIATIVE">Project</Link></div>
    <form method="get" className="panel report-builder p-3 md:p-4"><input type="hidden" name="configured" value="1"/><input type="hidden" name="reportType" value="PROJECT_INITIATIVE"/>{saved&&<input type="hidden" name="reportId" value={saved.id}/>}
      <fieldset className="report-section report-primary-filters"><legend className="report-section-title">Primary filters</legend><div className="report-filter-grid">
        {select('projectOwnerId','Project Owner',owners.map(x=>({value:x.id,label:`${x.firstName} ${x.lastName}`})))}
        {select('projectStatus','Project Status',Object.entries(projectStatusLabels).map(([value,label])=>({value,label})))}
        {select('projectId','Project',projects.map(x=>({value:x.id,label:x.name})))}
        {select('primaryAccountId','Primary Account',accounts.map(x=>({value:x.id,label:x.name})))}
      </div></fieldset>
      <fieldset className="report-section"><legend className="report-section-title">More filters</legend><div className="report-filter-grid">
        {select('participantAccountId','Participant Account',accounts.map(x=>({value:x.id,label:x.name})))}
        {select('hasAccount','Account relationship',[{value:'true',label:'Has Account'},{value:'false',label:'No Account'}])}
        {select('hasOpportunities','Opportunities',[{value:'true',label:'Has Opportunities'},{value:'false',label:'No Opportunities'}])}
        {select('ownerId','Sales Rep',owners.filter(x=>actor.role!=='SALES'||x.id===actor.id).map(x=>({value:x.id,label:`${x.firstName} ${x.lastName}`})))}
        {select('stageId','Opportunity Stage',stages.map(x=>({value:x.id,label:x.name})))}
        {select('forecastCategory','Forecast Category',['PIPELINE','BEST_CASE','COMMIT','OMITTED','CLOSED'].map(x=>({value:x,label:x.replaceAll('_',' ')})))}
        {select('status','Opportunity Status',[{value:'OPEN',label:'Open'},{value:'WON',label:'Closed Won'},{value:'LOST',label:'Closed Lost'}],'Any')}
        {select('productCategoryId','Product Category',categories.map(x=>({value:x.id,label:x.name})))}
        {select('currency','Currency',currencies.map(x=>({value:x.code,label:x.code})))}
        {date('startDate','Project Start Date')}{date('targetEndDate','Target End Date')}{date('closeDate','Expected Close Date')}
      </div></fieldset>
      <fieldset className="report-section"><legend className="report-section-title">Display options</legend><div className="report-filter-grid"><label className="label">Group By<select className="field" name="groupBy" defaultValue={config.groupBy??''}><option value="">None</option>{Object.entries(definition.groupings).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><label className="label">Sort<select className="field" name="sortField" defaultValue={config.sort[0]?.field??'pipeline'}>{Object.entries(definition.sorts).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><label className="label">Direction<select className="field" name="sortDirection" defaultValue={config.sort[0]?.direction??'desc'}><option value="asc">Ascending</option><option value="desc">Descending</option></select></label></div></fieldset>
      <fieldset className="report-metrics"><legend className="report-metrics-title">Metrics</legend><div className="report-options">{Object.entries(definition.metrics).map(([value,label])=><label key={value} className="text-sm"><input className="mr-2" type="checkbox" name="metrics" value={value} defaultChecked={config.metrics.includes(value)}/>{label}</label>)}</div></fieldset>
      <fieldset className="report-columns"><legend className="report-columns-title">Detail columns</legend><div className="report-options">{Object.entries(definition.columns).map(([value,label])=><label key={value} className="text-sm"><input className="mr-2" type="checkbox" name="columns" value={value} defaultChecked={config.columns.includes(value)}/>{label}</label>)}</div></fieldset>
      <button className="btn-primary mt-3">Preview</button>
    </form>
    <ReportResults result={result} config={config} groupKey={Array.isArray(params.group)?params.group[0]:params.group}/>
    <form action={saveReportAction} className="panel mt-4 grid gap-3 p-4 sm:grid-cols-2 md:p-5"><h2 className="text-lg font-semibold sm:col-span-2">Save This Report</h2><input type="hidden" name="reportType" value="PROJECT_INITIATIVE"/><input type="hidden" name="configuration" value={JSON.stringify(config)}/>{saved&&<input type="hidden" name="reportId" value={saved.id}/>}<label className="label">Report name<input className="field" name="name" required maxLength={120} defaultValue={saved?.name??''}/></label><label className="label">Visibility<select className="field" name="visibility" defaultValue={saved?.visibility??'PERSONAL'}><option value="PERSONAL">Personal</option>{canShareReport(actor)&&<option value="SHARED">Shared</option>}</select></label><label className="label sm:col-span-2">Description<textarea className="field" name="description" maxLength={1000} defaultValue={saved?.description??''}/></label><div><button className="btn-primary">{saved?'Save changes':'Save report'}</button></div></form>
  </Content>;
}
