import { reportingCurrencies } from '@/lib/company-currency';
import { CurrencyControl } from '@/components/currency-control';
import { RecoverableActionForm } from '@/components/recoverable-action-form';
import { NAV_CATEGORIES } from '../../../lib/navigation-categories';
import Link from 'next/link';
import type {Actor} from '@/lib/authorization';
import {Content,PageHeader} from '@/components/shell';
import {ReportResults} from '@/components/report-results';
import { ReportSalesRepFilter } from '@/components/report-sales-rep-filter';
import { ReportEntityFilter } from '@/components/report-entity-filter';
import {prisma} from '@/lib/prisma';
import {filterValue,tradeShowConfigFromParams} from '@/lib/report-builder';
import {canCreateReport,canShareReport,executeTradeShowReport,reportRegistry,withoutTradeShowOpportunityFields, type ReportConfiguration} from '@/lib/reporting';
import {getModuleAvailability} from '@/lib/module-availability';
import {tradeShowReadWhere} from '@/lib/trade-shows';
import {tradeShowMetricGroups,tradeShowColumnGroups} from '@/lib/trade-show-report-presentation';
import {saveReportAction} from '../actions';

type Params=Record<string,string|string[]|undefined>;
type Saved={id:number;name:string;description:string|null;visibility:'PERSONAL'|'SHARED';configuration:unknown;updatedAt:Date}|null;
export async function TradeShowBuilder({params,actor,saved}:{params:Params;actor:Actor;saved:Saved}){
  const opportunitiesEnabled=(await getModuleAvailability()).effective.has('OPPORTUNITIES');
  const initial=tradeShowConfigFromParams(params,saved?.configuration);
  const config=(opportunitiesEnabled?initial:withoutTradeShowOpportunityFields(initial)) as ReportConfiguration;
  const hidden=new Set(['opportunity','opportunityOwner','opportunityStage','opportunityValue','weightedValue','currency','forecastCategory','opportunityCount','pipeline','weightedPipeline','commit','closedWonValue','closedWonOpportunityCount']);
  const available=(entries:Record<string,string>)=>Object.entries(entries).filter(([key])=>opportunitiesEnabled||!hidden.has(key));
  const definition=reportRegistry.TRADE_SHOW;
  const [result,shows,reps,stages,competitors,currencies]=await Promise.all([
    executeTradeShowReport(prisma,actor,config),
    prisma.tradeShow.findMany({where:tradeShowReadWhere(actor),select:{id:true,name:true},orderBy:[{startDate:'desc'},{name:'asc'}]}),
    prisma.user.findMany({where:{active:true,archivedAt:null,role:{in:['SALES','SALES_MANAGER']},...(actor.role==='SALES'?{id:actor.id}:{})},orderBy:[{lastName:'asc'},{firstName:'asc'}]}),
    opportunitiesEnabled?prisma.salesStage.findMany({orderBy:[{sortOrder:'asc'},{id:'asc'}]}):[],
    prisma.competitorOption.findMany({where:{OR:[{active:true},...(Number(filterValue(config,'competitorId'))?[{id:Number(filterValue(config,'competitorId'))}]:[])]},orderBy:[{sortOrder:'asc'},{name:'asc'}]}),
    opportunitiesEnabled?reportingCurrencies():[],
  ]);
  const advancedFilterCount=config.filters.filter(filter=>['accountLinked','contactLinked','competitorId','showDate','stageId','forecastCategory','converted','currency'].includes(filter.field)).length;
  const selected=(field:string)=>String(filterValue(config,field)??'');
  const select=(name:string,label:string,items:{value:string|number;label:string}[],empty='All')=><label className="label">{label}<select className="field" name={name} defaultValue={selected(name)}><option value="">{empty}</option>{items.map(item=><option key={item.value} value={item.value}>{item.label}</option>)}</select></label>;
  const dateFilter=config.filters.find(filter=>filter.field==='showDate'),dateChoice=dateFilter?.operator==='preset'?String(dateFilter.value):dateFilter?.operator==='between'?'CUSTOM':'ANY',dateRange=dateFilter?.operator==='between'?dateFilter.value as {from:string;to:string}:null;
  return <Content><PageHeader eyebrow={NAV_CATEGORIES.reports} title={saved?'Edit Trade Show Performance Report':'Trade Show Performance'} description={definition.description} action={<Link className="btn-secondary" href="/reports">Reports</Link>}/>
    <form method="get" aria-label="Trade Show report options" className="panel report-builder trade-show-report p-3 md:p-4"><input type="hidden" name="configured" value="1"/><input type="hidden" name="reportType" value="TRADE_SHOW"/>{saved&&<input type="hidden" name="reportId" value={saved.id}/>}
      <fieldset className="report-section report-primary-filters"><legend className="report-section-title">Lead filters</legend><div className="report-filter-grid">
        {select('tradeShowId','Trade Show',shows.map(show=>({value:show.id,label:show.name})))}
        <ReportSalesRepFilter actor={actor} reps={reps} selected={selected('ownerId')} label="Assigned Sales Rep"/>
        {select('leadStatus','Lead Status',['NEW','CONTACTED','QUALIFIED','CONVERTED','DISQUALIFIED'].map(value=>({value,label:value.charAt(0)+value.slice(1).toLowerCase()})))}
        {select('routing','Routing',[{value:'UNREVIEWED',label:'Unreviewed'},{value:'BIXOLON_SALES',label:'BIXOLON Sales'},{value:'REFERRED_TO_PARTNER',label:'Referred to Partner'},{value:'MARKETING_FOLLOW_UP',label:'Marketing Follow-Up'}])}
        <ReportEntityFilter type="account" name="referralPartnerId" label="Partner" selected={selected('referralPartnerId')} actor={actor} filters={{ partnerOnly: true }}/>
        {select('followUpStatus','Follow-Up',[{value:'OVERDUE',label:'Overdue'},{value:'SCHEDULED',label:'Scheduled'},{value:'MISSING',label:'No follow-up date'},{value:'NEW_NOT_CONTACTED',label:'New, not contacted'},{value:'QUALIFIED_NOT_CONVERTED',label:'Qualified, not converted'}])}
        <label className="label">Search<input className="field" name="search" defaultValue={selected('search')} placeholder="Lead, company, or email"/></label>
        <label className="label">Product Interest<input className="field" name="productInterest" defaultValue={selected('productInterest')} placeholder="Contains text"/></label>
      </div></fieldset>
      <details className="report-disclosure"><summary>Advanced Filters{advancedFilterCount>0&&<span className="report-disclosure-count"> ({advancedFilterCount} applied)</span>}</summary>
      <fieldset className="report-section"><legend className="sr-only">Advanced lead and event filters</legend><div className="report-filter-grid">
        {select('accountLinked','Account Match',[{value:'true',label:'Linked'},{value:'false',label:'Unresolved'}])}
        {select('contactLinked','Contact Match',[{value:'true',label:'Linked'},{value:'false',label:'Unresolved'}])}
        {select('competitorId','Competitor',competitors.map(item=>({value:item.id,label:item.name+(item.active?'':' (Inactive)')})))}
        <fieldset className="label"><legend>Event Date</legend><select className="field" aria-label="Event Date" name="showDatePreset" defaultValue={dateChoice}><option value="ANY">Any date</option><option value="THIS_MONTH">This Month</option><option value="THIS_QUARTER">This Quarter</option><option value="THIS_YEAR">This Year</option><option value="CUSTOM">Custom range</option></select><div className="mt-1 flex gap-1"><input className="field min-w-0" aria-label="Event date from" type="date" name="showDateFrom" defaultValue={dateRange?.from}/><input className="field min-w-0" aria-label="Event date to" type="date" name="showDateTo" defaultValue={dateRange?.to}/></div></fieldset>
        {opportunitiesEnabled&&select('stageId','Opportunity Stage',stages.map(stage=>({value:stage.id,label:stage.name})))}
        {opportunitiesEnabled&&select('forecastCategory','Forecast Category',['PIPELINE','BEST_CASE','COMMIT','OMITTED','CLOSED'].map(value=>({value,label:value.replaceAll('_',' ')})))}
        {opportunitiesEnabled&&<CurrencyControl name="currency" value={selected('currency')} historicalCodes={currencies.map(row => row.code)}>{select('currency','Currency',currencies.map(item=>({value:item.code,label:item.code})),'All currencies')}</CurrencyControl>}
        {select('converted','Conversion',[{value:'true',label:'Converted'},{value:'false',label:'Not Converted'}])}
      </div></fieldset></details>
      <fieldset className="report-section"><legend className="report-section-title">Display options</legend><div className="report-filter-grid"><label className="label">Group By<select className="field" name="groupBy" defaultValue={config.groupBy??''}><option value="">None</option>{available(definition.groupings).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><label className="label">Sort<select className="field" name="sortField" defaultValue={config.sort[0]?.field??'capturedDate'}>{available(definition.sorts).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><label className="label">Sort Order<select className="field" name="sortDirection" defaultValue={config.sort[0]?.direction??'desc'}><option value="asc">Ascending</option><option value="desc">Descending</option></select></label></div></fieldset>
      <details className="report-disclosure"><summary>Customize metrics <span className="report-disclosure-count">({config.metrics.length} selected)</span></summary>
        <p className="report-customize-help">Choose metrics for grouped results and additional summary cards. The routing overview always shows all destinations.</p>
        <div className="report-customize-groups">{Object.entries(tradeShowMetricGroups).map(([group,keys])=>{
          const entries=available(definition.metrics).filter(([key])=>keys.includes(key));
          return entries.length>0&&<fieldset key={group} className="report-choice-group"><legend>{group}</legend><div className="report-choice-grid">{entries.map(([value,label])=><label key={value}><input type="checkbox" name="metrics" value={value} defaultChecked={config.metrics.includes(value)}/>{label}</label>)}</div></fieldset>;
        })}</div>
      </details>
      <details className="report-disclosure"><summary>Customize columns <span className="report-disclosure-count">({config.columns.length} selected)</span></summary>
        <p className="report-customize-help">Choose the columns shown in lead details.</p>
        <div className="report-customize-groups">{Object.entries(tradeShowColumnGroups).map(([group,keys])=>{
          const entries=available(definition.columns).filter(([key])=>keys.includes(key));
          return entries.length>0&&<fieldset key={group} className="report-choice-group"><legend>{group}</legend><div className="report-choice-grid">{entries.map(([value,label])=><label key={value}><input type="checkbox" name="columns" value={value} defaultChecked={config.columns.includes(value)}/>{label}</label>)}</div></fieldset>;
        })}</div>
      </details>
      <div className="report-preview"><button className="btn-primary">Preview</button></div>
    </form>
    <ReportResults result={result} config={config} groupKey={Array.isArray(params.group)?params.group[0]:params.group}/>
    {canCreateReport(actor)&&<RecoverableActionForm action={saveReportAction} recordHref={saved ? `/reports/${saved.id}` : undefined} className="panel mt-4 grid gap-3 p-4 sm:grid-cols-2 md:p-5"><h2 className="text-lg font-semibold sm:col-span-2">Save This Report</h2><input type="hidden" name="reportType" value="TRADE_SHOW"/><input type="hidden" name="configuration" value={JSON.stringify(config)}/>{saved&&<><input type="hidden" name="reportId" value={saved.id}/><input type="hidden" name="editToken" value={saved.updatedAt.toISOString()}/></>}<label className="label">Report name<input className="field" name="name" required maxLength={120} defaultValue={saved?.name??''}/></label><label className="label">Visibility<select className="field" name="visibility" defaultValue={saved?.visibility??'PERSONAL'}><option value="PERSONAL">Personal</option>{canShareReport(actor)&&<option value="SHARED">Shared</option>}</select></label><label className="label sm:col-span-2">Description<textarea className="field" name="description" maxLength={1000} defaultValue={saved?.description??''}/></label><div><button className="btn-primary">{saved?'Save changes':'Save report'}</button></div></RecoverableActionForm>}
  </Content>;
}
