import Link from 'next/link';
import type { Actor } from '@/lib/authorization';
import { Content,PageHeader } from '@/components/shell';
import { ReportResults } from '@/components/report-results';
import { ReportCloseDateFields } from '@/components/report-close-date-fields';
import { prisma } from '@/lib/prisma';
import { filterValue,priceExceptionUsageConfigFromParams } from '@/lib/report-builder';
import { canShareReport,executePriceExceptionUsageReport,reportRegistry } from '@/lib/reporting';
import { saveReportAction } from '../actions';

type Params=Record<string,string|string[]|undefined>;
type Saved={id:number;name:string;description:string|null;visibility:'PERSONAL'|'SHARED';configuration:unknown}|null;
export async function PriceExceptionUsageBuilder({params,actor,saved}:{params:Params;actor:Actor;saved:Saved}){
  const config=priceExceptionUsageConfigFromParams(params,saved?.configuration);
  const [result,owners,stages,accounts,categories,products,skus,opportunities,priceExceptions,peSalespeople,currencies]=await Promise.all([
    executePriceExceptionUsageReport(prisma,actor,config),
    prisma.user.findMany({where:{active:true,archivedAt:null,...(actor.role==='SALES'?{id:actor.id}:{})},orderBy:[{lastName:'asc'},{firstName:'asc'}]}),
    prisma.salesStage.findMany({orderBy:[{sortOrder:'asc'},{id:'asc'}]}),
    prisma.account.findMany({where:{archivedAt:null,status:'ACTIVE',...(actor.role==='SALES'?{opportunityMemberships:{some:{opportunity:{ownerId:actor.id,archivedAt:null}}}}:{})},select:{id:true,name:true},orderBy:{name:'asc'}}),
    prisma.productCategory.findMany({orderBy:{name:'asc'}}),
    prisma.product.findMany({where:{archivedAt:null},select:{id:true,name:true},orderBy:{name:'asc'}}),
    prisma.productSku.findMany({select:{id:true,partNumber:true},orderBy:{partNumber:'asc'}}),
    prisma.opportunity.findMany({where:{archivedAt:null,...(actor.role==='SALES'?{ownerId:actor.id}:{})},select:{id:true,name:true},orderBy:{name:'asc'}}),
    prisma.priceException.findMany({where:{lines:{some:{opportunityProducts:{some:{archivedAt:null,opportunity:{archivedAt:null,...(actor.role==='SALES'?{ownerId:actor.id}:{})}}}}}},select:{id:true,peCode:true},orderBy:{peCode:'asc'}}),
    prisma.user.findMany({where:{assignedPriceExceptions:{some:{lines:{some:{opportunityProducts:{some:{archivedAt:null,opportunity:{archivedAt:null,...(actor.role==='SALES'?{ownerId:actor.id}:{})}}}}}}}},select:{id:true,firstName:true,lastName:true},orderBy:[{lastName:'asc'},{firstName:'asc'}]}),
    prisma.currency.findMany({where:{active:true},orderBy:{code:'asc'}}),
  ]);
  const selected=(field:string)=>String(filterValue(config,field)??'');
  const preset=String(config.filters.find(x=>x.field==='closeDate'&&x.operator==='preset')?.value??'');
  const between=config.filters.find(x=>x.field==='closeDate'&&x.operator==='between')?.value as {from:string;to:string}|undefined;
  const definition=reportRegistry.PRICE_EXCEPTION_USAGE;
  const select=(name:string,label:string,items:{value:string|number;label:string}[],empty='All')=><label className="label">{label}<select className="field" name={name} defaultValue={selected(name)}><option value="">{empty}</option>{items.map(item=><option key={item.value} value={item.value}>{item.label}</option>)}</select></label>;
  return <Content><PageHeader eyebrow="Reports" title={saved?'Edit Price Exception Usage Report':'Price Exception Usage Report'} description="Analyze approved pricing usage across Opportunities, Accounts, products, and the sales team." action={<Link className="btn-secondary" href="/reports">Reports</Link>}/>
    <div className="mb-2 flex flex-wrap gap-2"><Link className="btn-secondary" href="/reports/new?reportType=PIPELINE">Pipeline</Link><Link className="btn-secondary" href="/reports/new?reportType=ACCOUNT_ACTIVITY">Account Activity</Link><Link className="btn-secondary" href="/reports/new?reportType=PRODUCT_PERFORMANCE">Product Performance</Link><Link className="btn-secondary" href="/reports/new?reportType=CHANNEL_PARTNER">Channel / Partner</Link><Link className="btn-secondary" href="/reports/new?reportType=PROJECT_INITIATIVE">Project</Link><Link className="btn-secondary" href="/reports/new?reportType=PRICE_EXCEPTION_USAGE">Price Exception Usage</Link></div>
    <form method="get" className="panel report-builder p-3 md:p-4"><input type="hidden" name="configured" value="1"/><input type="hidden" name="reportType" value="PRICE_EXCEPTION_USAGE"/>{saved&&<input type="hidden" name="reportId" value={saved.id}/>}
      <fieldset className="report-section report-primary-filters"><legend className="report-section-title">Primary filters</legend><div className="report-filter-grid">
        {select('ownerId','Sales Rep',owners.map(x=>({value:x.id,label:`${x.firstName} ${x.lastName}`})),'All permitted')}
        {select('productCategoryId','Product Category',categories.map(x=>({value:x.id,label:x.name})))}
        {select('productId','Product / Model',products.map(x=>({value:x.id,label:x.name})))}
        {select('skuId','SKU / Part Number',skus.map(x=>({value:x.id,label:x.partNumber})))}
      </div></fieldset>
      <fieldset className="report-section"><legend className="report-section-title">Opportunity and commercial filters</legend><div className="report-filter-grid">
        {select('status','Status',[{value:'OPEN',label:'Open'},{value:'WON',label:'Closed Won'},{value:'LOST',label:'Closed Lost'}],'Any')}
        {select('stageId','Stage',stages.map(x=>({value:x.id,label:x.name})))}
        {select('forecastCategory','Forecast Category',['PIPELINE','BEST_CASE','COMMIT','OMITTED','CLOSED'].map(x=>({value:x,label:x.replaceAll('_',' ')})))}
        {select('accountId','Account',accounts.map(x=>({value:x.id,label:x.name})))}
        {select('opportunityId','Opportunity',opportunities.map(x=>({value:x.id,label:x.name})))}
        {select('priceExceptionId','Price Exception',priceExceptions.map(x=>({value:x.id,label:x.peCode??`Unnumbered #${x.id}`})))}
        {select('peSalespersonId','PE Salesperson',peSalespeople.map(x=>({value:x.id,label:`${x.firstName} ${x.lastName}`})))}
        {select('moqStatus','MOQ Status',[{value:'MET',label:'MOQ Met'},{value:'NOT_MET',label:'MOQ Not Met'},{value:'UNKNOWN',label:'Unknown'}])}
        {select('overrideStatus','Override Status',[{value:'APPLIED',label:'Override Applied'},{value:'NONE',label:'No Override'}])}
        {select('currency','Currency',currencies.map(x=>({value:x.code,label:x.code})),'All currencies')}
        <ReportCloseDateFields initialChoice={between?'CUSTOM':preset||'ANY'} initialFrom={between?.from} initialTo={between?.to}/>
      </div></fieldset>
      <fieldset className="report-section"><legend className="report-section-title">Display options</legend><div className="report-filter-grid">
        <label className="label">Group By<select className="field" name="groupBy" defaultValue={config.groupBy??''}><option value="">None</option>{Object.entries(definition.groupings).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
        <label className="label">Sort<select className="field" name="sortField" defaultValue={config.sort[0]?.field??'lineValue'}>{Object.entries(definition.sorts).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
        <label className="label">Direction<select className="field" name="sortDirection" defaultValue={config.sort[0]?.direction??'desc'}><option value="asc">Ascending</option><option value="desc">Descending</option></select></label>
      </div></fieldset>
      <fieldset className="report-metrics"><legend className="report-metrics-title">Metrics</legend><div className="report-options">{Object.entries(definition.metrics).map(([value,label])=><label key={value} className="text-sm"><input className="mr-2" type="checkbox" name="metrics" value={value} defaultChecked={config.metrics.includes(value)}/>{label}</label>)}</div></fieldset>
      <fieldset className="report-columns"><legend className="report-columns-title">Detail columns</legend><div className="report-options">{Object.entries(definition.columns).map(([value,label])=><label key={value} className="text-sm"><input className="mr-2" type="checkbox" name="columns" value={value} defaultChecked={config.columns.includes(value)}/>{label}</label>)}</div></fieldset>
      <div className="report-preview"><button className="btn-primary">Preview</button></div>
    </form>
    <ReportResults result={result} config={config} groupKey={typeof params.group==='string'?params.group:undefined}/>
    <form action={saveReportAction} className="panel mt-4 grid gap-3 p-4 sm:grid-cols-2 md:p-5"><h2 className="text-lg font-semibold sm:col-span-2">Save This Report</h2><input type="hidden" name="reportType" value="PRICE_EXCEPTION_USAGE"/><input type="hidden" name="configuration" value={JSON.stringify(config)}/>{saved&&<input type="hidden" name="reportId" value={saved.id}/>}
      <label className="label">Report name<input className="field" name="name" required maxLength={120} defaultValue={saved?.name??''}/></label><label className="label">Visibility<select className="field" name="visibility" defaultValue={saved?.visibility??'PERSONAL'}><option value="PERSONAL">Personal</option>{canShareReport(actor)&&<option value="SHARED">Shared</option>}</select></label><label className="label sm:col-span-2">Description<textarea className="field" name="description" maxLength={1000} defaultValue={saved?.description??''}/></label><div><button className="btn-primary">{saved?'Save changes':'Save report'}</button></div>
    </form>
  </Content>;
}
