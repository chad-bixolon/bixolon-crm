import Link from 'next/link';
import type {Actor} from '@/lib/authorization';
import {Content,PageHeader} from '@/components/shell';
import {ReportResults} from '@/components/report-results';
import {prisma} from '@/lib/prisma';
import {filterValue,tradeShowConfigFromParams} from '@/lib/report-builder';
import {canCreateReport,canShareReport,executeTradeShowReport,reportRegistry} from '@/lib/reporting';
import {tradeShowReadWhere} from '@/lib/trade-shows';
import {saveReportAction} from '../actions';

type Params=Record<string,string|string[]|undefined>;
type Saved={id:number;name:string;description:string|null;visibility:'PERSONAL'|'SHARED';configuration:unknown}|null;
export async function TradeShowBuilder({params,actor,saved}:{params:Params;actor:Actor;saved:Saved}){
  const config=tradeShowConfigFromParams(params,saved?.configuration),definition=reportRegistry.TRADE_SHOW;
  const [result,shows,reps,stages,competitors,currencies]=await Promise.all([
    executeTradeShowReport(prisma,actor,config),
    prisma.tradeShow.findMany({where:tradeShowReadWhere(actor),select:{id:true,name:true},orderBy:[{startDate:'desc'},{name:'asc'}]}),
    prisma.user.findMany({where:{active:true,archivedAt:null,role:{in:['SALES','SALES_MANAGER']},...(actor.role==='SALES'?{id:actor.id}:{})},orderBy:[{lastName:'asc'},{firstName:'asc'}]}),
    prisma.salesStage.findMany({orderBy:[{sortOrder:'asc'},{id:'asc'}]}),
    prisma.competitorOption.findMany({where:{OR:[{active:true},...(Number(filterValue(config,'competitorId'))?[{id:Number(filterValue(config,'competitorId'))}]:[])]},orderBy:[{sortOrder:'asc'},{name:'asc'}]}),
    prisma.currency.findMany({where:{active:true},orderBy:{code:'asc'}}),
  ]);
  const selected=(field:string)=>String(filterValue(config,field)??'');
  const select=(name:string,label:string,items:{value:string|number;label:string}[],empty='All')=><label className="label">{label}<select className="field" name={name} defaultValue={selected(name)}><option value="">{empty}</option>{items.map(item=><option key={item.value} value={item.value}>{item.label}</option>)}</select></label>;
  const dateFilter=config.filters.find(filter=>filter.field==='showDate'),dateChoice=dateFilter?.operator==='preset'?String(dateFilter.value):dateFilter?.operator==='between'?'CUSTOM':'ANY',dateRange=dateFilter?.operator==='between'?dateFilter.value as {from:string;to:string}:null;
  return <Content><PageHeader eyebrow="Reports" title={saved?'Edit Trade Show Performance Report':'Trade Show Performance'} description={definition.description} action={<Link className="btn-secondary" href="/reports">Reports</Link>}/>
    <form method="get" className="panel report-builder p-3 md:p-4"><input type="hidden" name="configured" value="1"/><input type="hidden" name="reportType" value="TRADE_SHOW"/>{saved&&<input type="hidden" name="reportId" value={saved.id}/>} 
      <fieldset className="report-section report-primary-filters"><legend className="report-section-title">Lead filters</legend><div className="report-filter-grid">
        {select('tradeShowId','Trade Show',shows.map(show=>({value:show.id,label:show.name})))}
        {select('ownerId','Assigned Sales Rep',reps.map(rep=>({value:rep.id,label:`${rep.firstName} ${rep.lastName}`})),'All permitted')}
        {select('leadStatus','Lead Status',['NEW','CONTACTED','QUALIFIED','CONVERTED','DISQUALIFIED'].map(value=>({value,label:value.charAt(0)+value.slice(1).toLowerCase()})))}
        {select('converted','Conversion',[{value:'true',label:'Converted'},{value:'false',label:'Not Converted'}])}
        {select('accountLinked','Account Resolution',[{value:'true',label:'Linked'},{value:'false',label:'Unresolved'}])}
        {select('contactLinked','Contact Resolution',[{value:'true',label:'Linked'},{value:'false',label:'Unresolved'}])}
        {select('followUpStatus','Follow-Up',[{value:'OVERDUE',label:'Overdue'},{value:'SCHEDULED',label:'Scheduled'},{value:'MISSING',label:'No follow-up date'},{value:'NEW_NOT_CONTACTED',label:'New, not contacted'},{value:'QUALIFIED_NOT_CONVERTED',label:'Qualified, not converted'}])}
        <label className="label">Search<input className="field" name="search" defaultValue={selected('search')} placeholder="Lead, company, or email"/></label>
        <label className="label">Product Interest<input className="field" name="productInterest" defaultValue={selected('productInterest')} placeholder="Contains text"/></label>
        {select('competitorId','Resolved Competitor',competitors.map(item=>({value:item.id,label:item.name+(item.active?'':' (Inactive)')})))}
      </div></fieldset>
      <fieldset className="report-section"><legend className="report-section-title">Event and Opportunity filters</legend><div className="report-filter-grid">
        <fieldset className="label"><legend>Trade Show Date</legend><select className="field" name="showDatePreset" defaultValue={dateChoice}><option value="ANY">Any date</option><option value="THIS_MONTH">This Month</option><option value="THIS_QUARTER">This Quarter</option><option value="THIS_YEAR">This Year</option><option value="CUSTOM">Custom range</option></select><div className="mt-1 flex gap-1"><input className="field min-w-0" aria-label="Trade Show date from" type="date" name="showDateFrom" defaultValue={dateRange?.from}/><input className="field min-w-0" aria-label="Trade Show date to" type="date" name="showDateTo" defaultValue={dateRange?.to}/></div></fieldset>
        {select('stageId','Opportunity Stage',stages.map(stage=>({value:stage.id,label:stage.name})))}
        {select('forecastCategory','Forecast Category',['PIPELINE','BEST_CASE','COMMIT','OMITTED','CLOSED'].map(value=>({value,label:value.replaceAll('_',' ')})))}
        {select('currency','Currency',currencies.map(item=>({value:item.code,label:item.code})),'All currencies')}
      </div></fieldset>
      <fieldset className="report-section"><legend className="report-section-title">Display options</legend><div className="report-filter-grid"><label className="label">Group By<select className="field" name="groupBy" defaultValue={config.groupBy??''}><option value="">None</option>{Object.entries(definition.groupings).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><label className="label">Sort<select className="field" name="sortField" defaultValue={config.sort[0]?.field??'capturedDate'}>{Object.entries(definition.sorts).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><label className="label">Direction<select className="field" name="sortDirection" defaultValue={config.sort[0]?.direction??'desc'}><option value="asc">Ascending</option><option value="desc">Descending</option></select></label></div></fieldset>
      <fieldset className="report-metrics"><legend className="report-metrics-title">Metrics</legend><div className="report-options">{Object.entries(definition.metrics).map(([value,label])=><label key={value} className="text-sm"><input className="mr-2" type="checkbox" name="metrics" value={value} defaultChecked={config.metrics.includes(value)}/>{label}</label>)}</div></fieldset>
      <fieldset className="report-columns"><legend className="report-columns-title">Detail columns</legend><div className="report-options">{Object.entries(definition.columns).map(([value,label])=><label key={value} className="text-sm"><input className="mr-2" type="checkbox" name="columns" value={value} defaultChecked={config.columns.includes(value)}/>{label}</label>)}</div></fieldset>
      <div className="report-preview"><button className="btn-primary">Preview</button></div>
    </form>
    <ReportResults result={result} config={config} groupKey={Array.isArray(params.group)?params.group[0]:params.group}/>
    {canCreateReport(actor)&&<form action={saveReportAction} className="panel mt-4 grid gap-3 p-4 sm:grid-cols-2 md:p-5"><h2 className="text-lg font-semibold sm:col-span-2">Save This Report</h2><input type="hidden" name="reportType" value="TRADE_SHOW"/><input type="hidden" name="configuration" value={JSON.stringify(config)}/>{saved&&<input type="hidden" name="reportId" value={saved.id}/>}<label className="label">Report name<input className="field" name="name" required maxLength={120} defaultValue={saved?.name??''}/></label><label className="label">Visibility<select className="field" name="visibility" defaultValue={saved?.visibility??'PERSONAL'}><option value="PERSONAL">Personal</option>{canShareReport(actor)&&<option value="SHARED">Shared</option>}</select></label><label className="label sm:col-span-2">Description<textarea className="field" name="description" maxLength={1000} defaultValue={saved?.description??''}/></label><div><button className="btn-primary">{saved?'Save changes':'Save report'}</button></div></form>}
  </Content>;
}
