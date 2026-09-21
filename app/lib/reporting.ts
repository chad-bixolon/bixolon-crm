import { ForecastCategory, Prisma, type PrismaClient } from '@prisma/client';
import { can, opportunityScope, type Actor } from './authorization';
import { lineTotal, opportunityTotal, weightedValue } from './opportunities';
import { daysSince, engagementAccountWhere, hasNoActivityInDays, latestAccountActivityOrder } from './engagement';
import { getSettings } from './configuration';

export const reportTypes = ['PIPELINE','ACCOUNT_ACTIVITY','PRODUCT_PERFORMANCE','CHANNEL_PARTNER','PROJECT_INITIATIVE','PRICE_EXCEPTION_USAGE'] as const;
export type CuratedReportType = typeof reportTypes[number];
export const reportVisibilities = ['PERSONAL','SHARED'] as const;
export type ReportVisibilityValue = typeof reportVisibilities[number];
export type ReportFilter = { field: string; operator: string; value: unknown };
export type ReportSort = { field: string; direction: 'asc' | 'desc' };
export type ReportConfiguration = { filters: ReportFilter[]; groupBy: string | null; sort: ReportSort[]; columns: string[]; metrics: string[] };

type FieldDefinition = { label: string; operators: readonly string[] };
export type ReportTypeDefinition = {
  label: string;
  description: string;
  grain: string;
  implemented: boolean;
  semanticNote: string;
  filters: Record<string, FieldDefinition>;
  columns: Record<string, string>;
  groupings: Record<string, string>;
  metrics: Record<string, string>;
  sorts: Record<string, string>;
};

const pipelineDefinition: ReportTypeDefinition = {
  label: 'Pipeline', description: 'Pipeline, weighted pipeline, and Opportunity analysis', grain: 'Opportunity', implemented: true,
  semanticNote: 'Opportunities are counted once in report totals, even when they appear in more than one group.',
  filters: {
    ownerId: { label: 'Sales rep', operators: ['eq'] }, activeSalesRep: { label: 'Active Sales Reps', operators: ['eq'] }, stageId: { label: 'Stage', operators: ['eq'] }, status: { label: 'Status', operators: ['eq'] },
    closeDate: { label: 'Close date', operators: ['preset','between'] }, createdDate: { label: 'Created date', operators: ['preset','between'] },
    accountId: { label: 'Participating Account', operators: ['eq'] }, accountOwnerId: { label: 'Account owner', operators: ['eq'] }, industry: { label: 'Industry', operators: ['eq'] }, territory: { label: 'Territory', operators: ['eq'] }, strategicAccount: { label: 'Strategic Account', operators: ['eq'] },
    participantRole: { label: 'Participant role', operators: ['eq'] }, forecastCategory: { label: 'Forecast Category', operators: ['eq'] }, productCategoryId: { label: 'Product Category', operators: ['eq'] }, productId: { label: 'Product', operators: ['eq'] }, skuId: { label: 'SKU', operators: ['eq'] }, projectId: { label: 'Project', operators: ['eq'] }, currency: { label: 'Currency', operators: ['eq'] },
  },
  columns: { opportunity: 'Opportunity', account: 'Account', owner: 'Owner', stage: 'Stage', closeDate: 'Close Date', value: 'Value', weightedValue: 'Weighted Value', currency: 'Currency' },
  groupings: { owner: 'Sales Rep', stage: 'Stage', account: 'Account', industry: 'Industry', territory: 'Territory', productCategory: 'Product Category', project: 'Project' },
  metrics: { pipeline: 'Pipeline', weightedPipeline: 'Weighted Pipeline', opportunityCount: 'Opportunity Count', averageOpportunityValue: 'Average Opportunity Value' },
  sorts: { opportunity: 'Opportunity', account: 'Account', owner: 'Owner', stage: 'Stage', closeDate: 'Close Date', value: 'Value' },
};
const accountActivityDefinition: ReportTypeDefinition = {
  label: 'Account Activity', description: 'Account activity, follow-up, and stale Accounts', grain: 'Account', implemented: true,
  semanticNote: 'Each active, unarchived Account appears once. Activity Count includes all non-archived Activities recorded for that Account.',
  filters: { ownerId:{label:'Sales Rep',operators:['eq']},accountId:{label:'Account',operators:['eq']},industry:{label:'Industry',operators:['eq']},territory:{label:'Territory',operators:['eq']},strategicAccount:{label:'Strategic Account',operators:['eq']},businessRole:{label:'Business Role',operators:['eq']},activityType:{label:'Latest Activity Type',operators:['eq']},minDays:{label:'No activity in at least N days',operators:['gte']},hasActivity:{label:'Has Activity',operators:['eq']} },
  columns: {account:'Account',owner:'Owner',industry:'Industry',territory:'Territory',businessRoles:'Business Roles',strategicAccount:'Strategic Account',lastActivity:'Last Activity',daysSinceLastActivity:'Days Since Last Activity',activityStatus:'Activity Status',latestActivityType:'Latest Activity Type',latestActivityBy:'Latest Activity By',activityCount:'Activity Count'},
  groupings: {owner:'Sales Rep',industry:'Industry',territory:'Territory',latestActivityType:'Latest Activity Type',activityStatus:'Activity Status'},
  metrics: {accountCount:'Account Count',noActivityCount:'Accounts With No Activity',staleAccountCount:'Stale Account Count',activityCount:'Activity Count',averageDaysSinceLastActivity:'Average Days Since Last Activity'},
  sorts: {account:'Account',owner:'Owner',lastActivity:'Last Activity',daysSinceLastActivity:'Days Since Last Activity',activityCount:'Activity Count'},
};
const productPerformanceDefinition: ReportTypeDefinition = {
  label:'Product Performance', description:'Product and category opportunity line performance', grain:'OpportunityProduct', implemented:true,
  semanticNote:'Each active product line contributes its own quantity × Opportunity unit price. Opportunity Count is distinct within each group; totals are separated by currency and SKU price unit. Lines without a SKU use Each.',
  filters:{ownerId:{label:'Sales Rep',operators:['eq']},stageId:{label:'Stage',operators:['eq']},forecastCategory:{label:'Forecast Category',operators:['eq']},status:{label:'Status',operators:['eq']},closeDate:{label:'Expected Close Date',operators:['preset','between']},accountId:{label:'Account',operators:['eq']},industry:{label:'Industry',operators:['eq']},territory:{label:'Territory',operators:['eq']},strategicAccount:{label:'Strategic Account',operators:['eq']},productCategoryId:{label:'Product Category',operators:['eq']},productId:{label:'Product',operators:['eq']},skuId:{label:'SKU',operators:['eq']},priceSource:{label:'Pricing Source',operators:['eq']},projectId:{label:'Project',operators:['eq']},currency:{label:'Currency',operators:['eq']}},
  columns:{opportunity:'Opportunity',account:'Account',owner:'Owner',stage:'Stage',forecastCategory:'Forecast Category',closeDate:'Expected Close Date',productCategory:'Product Category',product:'Product / Model',sku:'SKU / Part Number',quantity:'Quantity',unit:'Unit',unitPrice:'Unit Price',lineValue:'Line Value',priceSource:'Pricing Source',currency:'Currency',project:'Project',peCode:'PE #'},
  groupings:{productCategory:'Product Category',product:'Product / Model',sku:'SKU',owner:'Sales Rep',account:'Account',stage:'Stage',forecastCategory:'Forecast Category',priceSource:'Pricing Source',project:'Project'},
  metrics:{lineValue:'Line Value',quantity:'Quantity',opportunityCount:'Opportunity Count',productLineCount:'Product Line Count',averageUnitPrice:'Average Unit Price'},
  sorts:{product:'Product / Model',sku:'SKU',quantity:'Quantity',lineValue:'Line Value',opportunityCount:'Opportunity Count',averageUnitPrice:'Average Unit Price',closeDate:'Expected Close Date',owner:'Sales Rep'},
};

function foundation(label: string, description: string, grain: string, note: string): ReportTypeDefinition {
  return { label, description, grain, implemented: false, semanticNote: note, filters: {}, columns: {}, groupings: {}, metrics: {}, sorts: {} };
}

export const reportRegistry: Record<CuratedReportType, ReportTypeDefinition> = {
  PIPELINE: pipelineDefinition,
  ACCOUNT_ACTIVITY: accountActivityDefinition,
  PRODUCT_PERFORMANCE: productPerformanceDefinition,
  CHANNEL_PARTNER: { ...foundation('Channel / Partner', 'Distributor, reseller, and partner performance', 'Opportunity', 'Participant roles describe each deal; Account business roles describe the company generally. Organization totals must deduplicate Opportunities across partners.'),
    filters: { participantRole: { label: 'Opportunity participant role', operators: ['eq'] }, accountBusinessRole: { label: 'Account business role', operators: ['eq'] } },
    groupings: { participantRole: 'Opportunity participant role', accountBusinessRole: 'Account business role' } },
  PROJECT_INITIATIVE: foundation('Project / Initiative', 'Projects and strategic initiative performance', 'Opportunity', 'Opportunities remain authoritative and totals must deduplicate Opportunities across Projects.'),
  PRICE_EXCEPTION_USAGE: foundation('Price Exception Usage', 'Price Exception usage and associated Opportunities', 'OpportunityProduct', 'Metrics describe PE-associated pricing use, not PE-generated revenue, and must retain PE visibility rules.'),
};

export const builtInReportTypes = ['MY_OPEN_PIPELINE','PIPELINE_THIS_QUARTER','PIPELINE_BY_SALES_REP','ACCOUNT_ENGAGEMENT','PRODUCT_THIS_QUARTER','PIPELINE_BY_PRODUCT'] as const;
export type BuiltInReportType = typeof builtInReportTypes[number];

export function canRunReportType(actor: Actor, reportType: unknown) {
  return reportTypes.includes(reportType as CuratedReportType) && reportRegistry[reportType as CuratedReportType].implemented && can(actor,reportType === 'ACCOUNT_ACTIVITY' ? 'sales.write' : 'sales.read');
}
export function getVisibleReportTypes(actor: Actor) { return reportTypes.filter(reportType=>canRunReportType(actor,reportType)); }
export function getCreatableReportTypes(actor: Actor) { return can(actor,'sales.write') ? getVisibleReportTypes(actor) : []; }
export function canViewBuiltInReport(actor: Actor, reportType: BuiltInReportType) {
  return reportType === 'ACCOUNT_ENGAGEMENT' ? canRunReportType(actor,'ACCOUNT_ACTIVITY') : reportType === 'PRODUCT_THIS_QUARTER' || reportType === 'PIPELINE_BY_PRODUCT' ? getCreatableReportTypes(actor).includes('PRODUCT_PERFORMANCE') : getCreatableReportTypes(actor).includes('PIPELINE');
}
export function getVisibleBuiltInReports(actor: Actor) { return builtInReportTypes.filter(reportType=>canViewBuiltInReport(actor,reportType)); }
export function canAccessReports(actor: Actor) { return getVisibleReportTypes(actor).length > 0 || getVisibleBuiltInReports(actor).length > 0; }

const configKeys = ['filters','groupBy','sort','columns','metrics'];
function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function exactKeys(value: Record<string, unknown>, allowed: readonly string[]) { return Object.keys(value).every(key => allowed.includes(key)); }
function positiveInteger(value: unknown) { return typeof value === 'number' && Number.isSafeInteger(value) && value > 0; }
function dateString(value: unknown) { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)); }
const presets = ['THIS_MONTH','THIS_QUARTER','NEXT_QUARTER','THIS_YEAR'] as const;
const statuses = ['OPEN','WON','LOST'] as const;
const participantRoles = ['END_USER','VAR_RESELLER','DISTRIBUTOR','ISV_PARTNER','OEM','OTHER','MEDIA_PARTNER'] as const;
export const channelPartnerAccountRoles = ['DISTRIBUTOR','VAR','ISV','OEM','PARTNER','MEDIA_PARTNER'] as const;
export const channelPartnerParticipantRoles = ['DISTRIBUTOR','VAR_RESELLER','ISV_PARTNER','OEM','MEDIA_PARTNER'] as const;

function validFilterValue(filter: ReportFilter) {
  if (['ownerId','stageId','accountId','accountOwnerId','productCategoryId','productId','skuId','projectId','minDays'].includes(filter.field)) return positiveInteger(filter.value);
  if (filter.field === 'hasActivity') return typeof filter.value === 'boolean';
  if (filter.field === 'businessRole') return ['END_USER','DISTRIBUTOR','VAR','ISV','OEM','PARTNER','MEDIA_PARTNER'].includes(String(filter.value));
  if (filter.field === 'activityType') return typeof filter.value === 'string' && filter.value.length > 0 && filter.value.length <= 100;
  if (filter.field === 'strategicAccount') return typeof filter.value === 'boolean';
  if (filter.field === 'activeSalesRep') return filter.value === true;
  if (filter.field === 'status') return statuses.includes(filter.value as typeof statuses[number]);
  if (filter.field === 'priceSource') return ['MANUAL','CATALOG','PRICE_EXCEPTION'].includes(String(filter.value));
  if (filter.field === 'participantRole') return participantRoles.includes(filter.value as typeof participantRoles[number]);
  if (filter.field === 'forecastCategory') return filter.value === 'IN_FORECAST' || Object.values(ForecastCategory).includes(filter.value as ForecastCategory);
  if (filter.field === 'accountBusinessRole') return channelPartnerAccountRoles.includes(filter.value as typeof channelPartnerAccountRoles[number]);
  if (['industry','territory'].includes(filter.field)) return typeof filter.value === 'string' && filter.value.length > 0 && filter.value.length <= 100;
  if (filter.field === 'currency') return typeof filter.value === 'string' && /^[A-Z]{3}$/.test(filter.value);
  if (['closeDate','createdDate'].includes(filter.field) && filter.operator === 'preset') return presets.includes(filter.value as typeof presets[number]);
  if (['closeDate','createdDate'].includes(filter.field) && filter.operator === 'between') return object(filter.value) && exactKeys(filter.value, ['from','to']) && dateString(filter.value.from) && dateString(filter.value.to) && String(filter.value.from) <= String(filter.value.to);
  return false;
}

export function defaultReportConfiguration(reportType: CuratedReportType): ReportConfiguration {
  if (reportType === 'PRODUCT_PERFORMANCE') return {filters:[{field:'status',operator:'eq',value:'OPEN'}],groupBy:'productCategory',sort:[{field:'lineValue',direction:'desc'}],columns:['opportunity','account','owner','stage','closeDate','productCategory','product','sku','quantity','unit','unitPrice','lineValue','priceSource','currency'],metrics:['lineValue','quantity','opportunityCount','productLineCount','averageUnitPrice']};
  if (reportType === 'ACCOUNT_ACTIVITY') return {filters:[],groupBy:null,sort:[{field:'lastActivity',direction:'asc'}],columns:['account','owner','industry','territory','businessRoles','strategicAccount','lastActivity','daysSinceLastActivity','activityStatus','latestActivityType','latestActivityBy','activityCount'],metrics:['accountCount','noActivityCount','staleAccountCount','activityCount','averageDaysSinceLastActivity']};
  if (reportType !== 'PIPELINE') return { filters: [], groupBy: null, sort: [], columns: [], metrics: [] };
  return { filters: [{ field: 'status', operator: 'eq', value: 'OPEN' }], groupBy: null, sort: [{ field: 'closeDate', direction: 'asc' }], columns: ['opportunity','account','owner','stage','closeDate','value','weightedValue','currency'], metrics: ['pipeline','weightedPipeline','opportunityCount','averageOpportunityValue'] };
}

export function validateReportConfiguration(reportType: unknown, input: unknown): ReportConfiguration {
  if (!reportTypes.includes(reportType as CuratedReportType)) throw new Error('Unknown report type.');
  const definition = reportRegistry[reportType as CuratedReportType];
  if (!definition.implemented) throw new Error(`${definition.label} reports are not available.`);
  if (!object(input) || !exactKeys(input, configKeys)) throw new Error('Report configuration has unsupported fields.');
  if (!Array.isArray(input.filters) || !Array.isArray(input.sort) || !Array.isArray(input.columns) || !Array.isArray(input.metrics)) throw new Error('Report configuration is malformed.');
  if (input.filters.length > 30 || input.sort.length > 3 || input.columns.length > 20 || input.metrics.length > 10) throw new Error('Report configuration is too large.');
  const filters = input.filters.map(raw => {
    if (!object(raw) || !exactKeys(raw, ['field','operator','value']) || typeof raw.field !== 'string' || typeof raw.operator !== 'string') throw new Error('Report filter is malformed.');
    const supported = definition.filters[raw.field];
    if (!supported || !supported.operators.includes(raw.operator)) throw new Error(`Unsupported report filter: ${raw.field}.`);
    const filter = { field: raw.field, operator: raw.operator, value: raw.value };
    if (!validFilterValue(filter)) throw new Error(`Invalid value for report filter: ${raw.field}.`);
    return filter;
  });
  const groupBy = input.groupBy === null ? null : typeof input.groupBy === 'string' && definition.groupings[input.groupBy] ? input.groupBy : (() => { throw new Error('Unsupported report grouping.'); })();
  const sort = input.sort.map(raw => {
    if (!object(raw) || !exactKeys(raw, ['field','direction']) || typeof raw.field !== 'string' || !definition.sorts[raw.field] || !['asc','desc'].includes(String(raw.direction))) throw new Error('Unsupported report sort.');
    return { field: raw.field, direction: raw.direction as 'asc'|'desc' };
  });
  const columns = input.columns.map(String); if (new Set(columns).size !== columns.length || columns.some(column => !definition.columns[column])) throw new Error('Unsupported report column.');
  const metrics = input.metrics.map(String); if (new Set(metrics).size !== metrics.length || metrics.some(metric => !definition.metrics[metric])) throw new Error('Unsupported report metric.');
  if (!columns.length || !metrics.length) throw new Error('Choose at least one column and metric.');
  return { filters, groupBy, sort, columns, metrics };
}

export function canCreateReport(actor: Actor) { return getCreatableReportTypes(actor).length > 0; }
export function canShareReport(actor: Actor) { return canCreateReport(actor) && ['ADMIN','SALES_MANAGER'].includes(actor.role); }
export function canViewReportDefinition(actor: Actor, report: { ownerId: number; visibility: ReportVisibilityValue; reportType: CuratedReportType; archivedAt?: Date | null }) { return !report.archivedAt && canRunReportType(actor,report.reportType) && (actor.role === 'ADMIN' || report.ownerId === actor.id || report.visibility === 'SHARED'); }
export function canEditReportDefinition(actor: Actor, report: { ownerId: number; visibility: ReportVisibilityValue; reportType: CuratedReportType }) { return canRunReportType(actor,report.reportType) && (actor.role === 'ADMIN' || (report.ownerId === actor.id && canCreateReport(actor))); }
export function savedReportWhere(actor: Actor): Prisma.ReportDefinitionWhereInput { return { archivedAt: null, reportType: { in: getVisibleReportTypes(actor) }, ...(actor.role === 'ADMIN' ? {} : { OR: [{ ownerId: actor.id }, { visibility: 'SHARED' }] }) }; }

function easternParts(now: Date) { const parts = new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now); const get=(key:string)=>Number(parts.find(part=>part.type===key)?.value); return { year:get('year'), month:get('month'), day:get('day') }; }
export function reportDatePreset(preset: typeof presets[number], now = new Date()) {
  const {year,month}=easternParts(now); let startMonth=month-1, startYear=year, endMonth:number, endYear:number;
  if (preset === 'THIS_MONTH') { endMonth=startMonth+1; endYear=startYear; }
  else if (preset === 'THIS_QUARTER') { startMonth=Math.floor(startMonth/3)*3; endMonth=startMonth+3; endYear=startYear; }
  else if (preset === 'NEXT_QUARTER') { startMonth=Math.floor(startMonth/3)*3+3; startYear+=Math.floor(startMonth/12); startMonth%=12; endMonth=startMonth+3; endYear=startYear; }
  else { startMonth=0; endMonth=0; endYear=startYear+1; }
  if (endMonth >= 12) { endYear += Math.floor(endMonth/12); endMonth%=12; }
  return { gte: new Date(Date.UTC(startYear,startMonth,1)), lt: new Date(Date.UTC(endYear,endMonth,1)) };
}

function pipelineWhere(config: ReportConfiguration, actor: Actor, now: Date): Prisma.OpportunityWhereInput {
  const clauses: Prisma.OpportunityWhereInput[] = [{ archivedAt: null }, opportunityScope(actor)];
  for (const filter of config.filters) {
    const value = filter.value;
    if (filter.field === 'ownerId') clauses.push({ ownerId: value as number });
    else if (filter.field === 'activeSalesRep') clauses.push({ owner: { active: true, archivedAt: null, role: { in: ['SALES','SALES_MANAGER'] } } });
    else if (filter.field === 'stageId') clauses.push({ stageId: value as number });
    else if (filter.field === 'status') clauses.push(value === 'OPEN' ? { stage: { isClosed: false } } : value === 'WON' ? { stage: { isClosed: true, isWon: true } } : { stage: { isClosed: true, isWon: false } });
    else if (filter.field === 'accountId') clauses.push({ participants: { some: { accountId: value as number } } });
    else if (filter.field === 'accountOwnerId') clauses.push({ participants: { some: { account: { ownerId: value as number } } } });
    else if (filter.field === 'industry') clauses.push({ participants: { some: { account: { industry: value as string } } } });
    else if (filter.field === 'territory') clauses.push({ participants: { some: { account: { territory: value as string } } } });
    else if (filter.field === 'strategicAccount') clauses.push({ participants: { some: { account: { strategicAccount: value as boolean } } } });
    else if (filter.field === 'participantRole') clauses.push({ participants: { some: { roles: { some: { role: value as never } } } } });
    else if (filter.field === 'forecastCategory') clauses.push({ forecastCategory: value === 'IN_FORECAST' ? { in: [ForecastCategory.PIPELINE, ForecastCategory.BEST_CASE, ForecastCategory.COMMIT] } : value as ForecastCategory });
    else if (filter.field === 'productCategoryId') clauses.push({ products: { some: { archivedAt: null, product: { categoryId: value as number } } } });
    else if (filter.field === 'productId') clauses.push({ products: { some: { archivedAt: null, productId: value as number } } });
    else if (filter.field === 'skuId') clauses.push({ products: { some: { archivedAt: null, skuId: value as number } } });
    else if (filter.field === 'projectId') clauses.push({ projects: { some: { projectId: value as number } } });
    else if (filter.field === 'currency') clauses.push({ currencyCode: value as string });
    else if (filter.field === 'closeDate' || filter.field === 'createdDate') {
      const bounds = filter.operator === 'preset' ? reportDatePreset(value as typeof presets[number], now) : { gte: new Date(`${(value as {from:string}).from}T00:00:00Z`), lt: new Date(new Date(`${(value as {to:string}).to}T00:00:00Z`).getTime()+86400000) };
      clauses.push(filter.field === 'closeDate' ? { expectedCloseDate: bounds } : { createdAt: bounds });
    }
  }
  return { AND: clauses };
}

type PipelineDbRow = Prisma.OpportunityGetPayload<{ include: { stage: true; owner: true; participants: { include: { account: { include: { owner: true; industryCategory: true; territoryCategory: true } }; roles: true } }; products: { include: { product: { include: { category: true } }; sku: true } }; projects: { include: { project: { include: { owner: true } } } } } }>;
export type CurrencyMetrics = { currency: string; opportunityCount: number; pipeline: string; weightedPipeline: string; averageOpportunityValue: string };
export type PipelineDetailRow = { id: number; opportunity: string; accounts: string; owner: string; stage: string; forecastCategory: string; closeDate: string | null; value: string; weightedValue: string; probability: number; currency: string; groupKeys: string[] };
export type PipelineGroup = { key: string; label: string; metrics: CurrencyMetrics[]; opportunityIds: number[] };
export type PipelineReportResult = { reportType: 'PIPELINE'; summary: CurrencyMetrics[]; groups: PipelineGroup[]; rows: PipelineDetailRow[]; currencies: string[]; filterCount: number; semanticNote: string };

function metrics(rows: PipelineDbRow[]): CurrencyMetrics[] {
  return [...new Set(rows.map(row=>row.currencyCode))].sort().map(currency => { const selected=rows.filter(row=>row.currencyCode===currency); const totals=selected.map(row=>opportunityTotal(row.products)); const pipeline=totals.reduce((sum,value)=>sum.add(value),new Prisma.Decimal(0)); const weighted=selected.reduce((sum,row,index)=>sum.add(weightedValue(totals[index],row.probability??row.stage.probability)),new Prisma.Decimal(0)); return { currency, opportunityCount:selected.length, pipeline:pipeline.toFixed(2), weightedPipeline:weighted.toFixed(2), averageOpportunityValue:(selected.length?pipeline.div(selected.length):new Prisma.Decimal(0)).toFixed(2) }; });
}
function groupValues(row: PipelineDbRow, groupBy: string | null): {key:string;label:string}[] {
  if (!groupBy) return [];
  if (groupBy === 'owner') return [{ key:String(row.ownerId??'none'), label:row.owner?`${row.owner.firstName} ${row.owner.lastName}`:'Unassigned' }];
  if (groupBy === 'stage') return [{ key:String(row.stageId), label:row.stage.name }];
  if (groupBy === 'account') return row.participants.length ? row.participants.map(x=>({key:String(x.accountId),label:x.account.name})) : [{key:'none',label:'No participating Account'}];
  if (groupBy === 'industry') return row.participants.length ? [...new Map(row.participants.map(x=>[x.account.industry??'none',{key:x.account.industry??'none',label:x.account.industryCategory?.name??x.account.industry??'No Industry'}])).values()] : [{key:'none',label:'No Industry'}];
  if (groupBy === 'territory') return row.participants.length ? [...new Map(row.participants.map(x=>[x.account.territory??'none',{key:x.account.territory??'none',label:x.account.territoryCategory?.name??x.account.territory??'No Territory'}])).values()] : [{key:'none',label:'No Territory'}];
  if (groupBy === 'productCategory') return row.products.length ? [...new Map(row.products.map(x=>[String(x.product.categoryId??'none'),{key:String(x.product.categoryId??'none'),label:x.product.category?.name??'No Product Category'}])).values()] : [{key:'none',label:'No Product Category'}];
  if (groupBy === 'project') return row.projects.length ? row.projects.map(x=>({key:String(x.projectId),label:x.project.name})) : [{key:'none',label:'No Project'}];
  return [];
}
function sortRows(rows: PipelineDbRow[], sort: ReportSort[]) {
  const specs=sort.length?sort:[{field:'closeDate',direction:'asc' as const}];
  return [...rows].sort((a,b)=>{ for(const spec of specs){ const read=(row:PipelineDbRow):string|number=>spec.field==='opportunity'?row.name:spec.field==='account'?(row.participants[0]?.account.name??''):spec.field==='owner'?(row.owner?`${row.owner.lastName} ${row.owner.firstName}`:''):spec.field==='stage'?`${String(row.stage.sortOrder).padStart(8,'0')} ${row.stage.name}`:spec.field==='closeDate'?(row.expectedCloseDate?.getTime()??Number.MAX_SAFE_INTEGER):opportunityTotal(row.products).toNumber(); const av=read(a),bv=read(b),comp=av<bv?-1:av>bv?1:0; if(comp)return spec.direction==='asc'?comp:-comp; } return a.id-b.id; });
}

export async function executePipelineReport(client: PrismaClient, actor: Actor, rawConfig: unknown, now = new Date()): Promise<PipelineReportResult> {
  if (!canRunReportType(actor,'PIPELINE')) throw new Error('Access denied');
  const config=validateReportConfiguration('PIPELINE',rawConfig);
  const rows=sortRows(await client.opportunity.findMany({ where:pipelineWhere(config,actor,now), include:{ stage:true, owner:true, participants:{include:{account:{include:{owner:true,industryCategory:true,territoryCategory:true}},roles:true}}, products:{where:{archivedAt:null},include:{product:{include:{category:true}},sku:true}}, projects:{include:{project:{include:{owner:true}}}} } }),config.sort);
  const groups=new Map<string,{key:string;label:string;rows:PipelineDbRow[]}>();
  for(const row of rows) for(const group of groupValues(row,config.groupBy)){ const existing=groups.get(group.key)??{...group,rows:[]}; if(!existing.rows.some(item=>item.id===row.id))existing.rows.push(row); groups.set(group.key,existing); }
  return { reportType:'PIPELINE', summary:metrics(rows), groups:[...groups.values()].sort((a,b)=>a.label.localeCompare(b.label)).map(group=>({key:group.key,label:group.label,metrics:metrics(group.rows),opportunityIds:group.rows.map(row=>row.id)})), rows:rows.map(row=>{const value=opportunityTotal(row.products),probability=row.probability??row.stage.probability; return {id:row.id,opportunity:row.name,accounts:row.participants.map(x=>x.account.name).sort().join(', ')||'—',owner:row.owner?`${row.owner.firstName} ${row.owner.lastName}`:'Unassigned',stage:row.stage.name,forecastCategory:row.forecastCategory,closeDate:row.expectedCloseDate?.toISOString().slice(0,10)??null,value:value.toFixed(2),weightedValue:weightedValue(value,probability).toFixed(2),probability,currency:row.currencyCode,groupKeys:groupValues(row,config.groupBy).map(x=>x.key)};}), currencies:[...new Set(rows.map(row=>row.currencyCode))].sort(), filterCount:config.filters.length, semanticNote:pipelineDefinition.semanticNote };
}

const productLineInclude = {product:{select:{name:true,sku:true,categoryId:true,category:{select:{name:true}}}},sku:{select:{partNumber:true,priceUnit:true}},opportunity:{select:{name:true,ownerId:true,owner:{select:{firstName:true,lastName:true}},stageId:true,stage:{select:{name:true}},forecastCategory:true,expectedCloseDate:true,currencyCode:true,participants:{select:{accountId:true,account:{select:{name:true}}}},projects:{select:{projectId:true,project:{select:{name:true}}}}}}} as const;
type ProductLineDbRow = Prisma.OpportunityProductGetPayload<{include:typeof productLineInclude}>;
export type ProductMetrics = {currency:string;unit:string;lineValue:string;quantity:number;opportunityCount:number;productLineCount:number;averageUnitPrice:string};
export type ProductDetailRow = {id:number;opportunityId:number;opportunity:string;accounts:{id:number;name:string}[];owner:string;stage:string;forecastCategory:string;closeDate:string|null;productCategory:string;product:string;productId:number;sku:string;quantity:number;unit:string;unitPrice:string;lineValue:string;priceSource:string;currency:string;project:string;peCode:string;groupKeys:string[]};
export type ProductPerformanceResult = {reportType:'PRODUCT_PERFORMANCE';summary:ProductMetrics[];groups:{key:string;label:string;metrics:ProductMetrics[];lineIds:number[]}[];rows:ProductDetailRow[];currencies:string[];filterCount:number;semanticNote:string};
const priceSourceLabel = (source:string) => source==='PRICE_EXCEPTION'?'Price Exception':source==='CATALOG'?'Catalog':'Manual';
function productGroupValues(row:ProductLineDbRow, groupBy:string|null):{key:string;label:string}[] {
  const opportunity=row.opportunity;
  if(groupBy==='productCategory')return [{key:String(row.product.categoryId??'none'),label:row.product.category?.name??'No Product Category'}];
  if(groupBy==='product')return [{key:String(row.productId),label:row.product.name}];
  if(groupBy==='sku')return [{key:String(row.skuId??`legacy-${row.productId}`),label:row.sku?.partNumber??row.product.sku}];
  if(groupBy==='owner')return [{key:String(opportunity.ownerId??'none'),label:opportunity.owner?`${opportunity.owner.firstName} ${opportunity.owner.lastName}`:'Unassigned'}];
  if(groupBy==='stage')return [{key:String(opportunity.stageId),label:opportunity.stage.name}];
  if(groupBy==='forecastCategory')return [{key:opportunity.forecastCategory,label:opportunity.forecastCategory.replaceAll('_',' ')}];
  if(groupBy==='priceSource')return [{key:row.priceSource,label:priceSourceLabel(row.priceSource)}];
  if(groupBy==='account')return opportunity.participants.length?opportunity.participants.map(x=>({key:String(x.accountId),label:x.account.name})):[{key:'none',label:'No participating Account'}];
  if(groupBy==='project')return opportunity.projects.length?opportunity.projects.map(x=>({key:String(x.projectId),label:x.project.name})):[{key:'none',label:'No Project'}];
  return [];
}
function productMetrics(rows:ProductLineDbRow[]):ProductMetrics[] {
  return [...new Set(rows.map(row=>`${row.opportunity.currencyCode}|${row.sku?.priceUnit??'EACH'}`))].sort().map(key=>{
    const [currency,unit]=key.split('|');
    const selected=rows.filter(row=>row.opportunity.currencyCode===currency&&(row.sku?.priceUnit??'EACH')===unit);
    const value=selected.reduce((sum,row)=>sum.add(lineTotal(row)),new Prisma.Decimal(0));
    const quantity=selected.reduce((sum,row)=>sum+row.quantity,0);
    return {currency,unit,lineValue:value.toFixed(2),quantity,opportunityCount:new Set(selected.map(row=>row.opportunityId)).size,productLineCount:selected.length,averageUnitPrice:quantity?value.div(quantity).toFixed(2):'0.00'};
  });
}
export async function executeProductPerformanceReport(client:PrismaClient, actor:Actor, rawConfig:unknown, now=new Date()):Promise<ProductPerformanceResult> {
  if(!canRunReportType(actor,'PRODUCT_PERFORMANCE'))throw new Error('Access denied');
  const config=validateReportConfiguration('PRODUCT_PERFORMANCE',rawConfig);
  const opportunityConfig={...config,filters:config.filters.filter(filter=>!['productCategoryId','productId','skuId','priceSource'].includes(filter.field))};
  const lineClauses:Prisma.OpportunityProductWhereInput[]=[{archivedAt:null},{opportunity:pipelineWhere(opportunityConfig,actor,now)}];
  for(const filter of config.filters){
    if(filter.field==='productCategoryId')lineClauses.push({product:{categoryId:filter.value as number}});
    else if(filter.field==='productId')lineClauses.push({productId:filter.value as number});
    else if(filter.field==='skuId')lineClauses.push({skuId:filter.value as number});
    else if(filter.field==='priceSource')lineClauses.push({priceSource:filter.value as never});
  }
  // One scoped line query. No live PE join: the OpportunityProduct price and PE code are snapshots.
  const rows=await client.opportunityProduct.findMany({where:{AND:lineClauses},include:productLineInclude});
  const groups=new Map<string,{key:string;label:string;rows:ProductLineDbRow[]}>();
  for(const row of rows)for(const group of productGroupValues(row,config.groupBy)){const found=groups.get(group.key)??{...group,rows:[]};found.rows.push(row);groups.set(group.key,found);}
  const specs=config.sort.length?config.sort:[{field:'lineValue',direction:'desc' as const}];
  const read=(row:ProductLineDbRow,field:string):string|number=>field==='product'?row.product.name:field==='sku'?(row.sku?.partNumber??row.product.sku):field==='quantity'?row.quantity:field==='lineValue'?lineTotal(row).toNumber():field==='averageUnitPrice'?Number(row.estimatedUnitPrice):field==='closeDate'?(row.opportunity.expectedCloseDate?.getTime()??Number.MAX_SAFE_INTEGER):field==='owner'?(row.opportunity.owner?`${row.opportunity.owner.lastName} ${row.opportunity.owner.firstName}`:''):1;
  rows.sort((a,b)=>{for(const spec of specs){const x=read(a,spec.field),y=read(b,spec.field),cmp=x<y?-1:x>y?1:0;if(cmp)return spec.direction==='asc'?cmp:-cmp;}return a.id-b.id;});
  const comparableTotals=new Set(rows.map(row=>`${row.opportunity.currencyCode}|${row.sku?.priceUnit??'EACH'}`)).size<=1;
  const sortedGroups=[...groups.values()].sort((a,b)=>{if(!comparableTotals)return a.label.localeCompare(b.label);for(const spec of specs){const metric=(items:ProductLineDbRow[])=>{const value=items.reduce((sum,row)=>sum.add(lineTotal(row)),new Prisma.Decimal(0));const qty=items.reduce((sum,row)=>sum+row.quantity,0);return spec.field==='quantity'?qty:spec.field==='opportunityCount'?new Set(items.map(row=>row.opportunityId)).size:spec.field==='averageUnitPrice'?(qty?value.div(qty).toNumber():0):value.toNumber();};if(['quantity','lineValue','opportunityCount','averageUnitPrice'].includes(spec.field)){const x=metric(a.rows),y=metric(b.rows);if(x!==y)return spec.direction==='asc'?x-y:y-x;}}return a.label.localeCompare(b.label);});
  return {reportType:'PRODUCT_PERFORMANCE',summary:productMetrics(rows),groups:sortedGroups.map(group=>({key:group.key,label:group.label,metrics:productMetrics(group.rows),lineIds:group.rows.map(row=>row.id)})),rows:rows.map(row=>({id:row.id,opportunityId:row.opportunityId,opportunity:row.opportunity.name,accounts:row.opportunity.participants.map(x=>({id:x.accountId,name:x.account.name})).sort((a,b)=>a.name.localeCompare(b.name)),owner:row.opportunity.owner?`${row.opportunity.owner.firstName} ${row.opportunity.owner.lastName}`:'Unassigned',stage:row.opportunity.stage.name,forecastCategory:row.opportunity.forecastCategory,closeDate:row.opportunity.expectedCloseDate?.toISOString().slice(0,10)??null,productCategory:row.product.category?.name??'No Product Category',product:row.product.name,productId:row.productId,sku:row.sku?.partNumber??row.product.sku,quantity:row.quantity,unit:row.sku?.priceUnit??'EACH',unitPrice:new Prisma.Decimal(row.estimatedUnitPrice).toFixed(2),lineValue:lineTotal(row).toFixed(2),priceSource:priceSourceLabel(row.priceSource),currency:row.opportunity.currencyCode,project:row.opportunity.projects.map(x=>x.project.name).join(', ')||'—',peCode:row.priceSource==='PRICE_EXCEPTION'?(row.priceExceptionCode??'—'):'—',groupKeys:productGroupValues(row,config.groupBy).map(x=>x.key)})),currencies:[...new Set(rows.map(row=>row.opportunity.currencyCode))].sort(),filterCount:config.filters.length,semanticNote:productPerformanceDefinition.semanticNote};
}

type AccountDbRow = Prisma.AccountGetPayload<{include:{owner:true,industryCategory:true,territoryCategory:true,businessRoles:true,activities:{include:{activityType:true,user:true}}}}>;
export type AccountActivityMetrics = {accountCount:number;noActivityCount:number;staleAccountCount:number;activityCount:number;averageDaysSinceLastActivity:number|null};
export type AccountActivityDetailRow = {id:number;account:string;owner:string;industry:string;territory:string;businessRoles:string;strategicAccount:boolean;lastActivity:string|null;daysSinceLastActivity:number|null;activityStatus:string;latestActivityType:string;latestActivityBy:string;activityCount:number;groupKeys:string[]};
export type AccountActivityReportResult = {reportType:'ACCOUNT_ACTIVITY';summary:AccountActivityMetrics;groups:{key:string;label:string;metrics:AccountActivityMetrics;accountIds:number[]}[];rows:AccountActivityDetailRow[];filterCount:number;semanticNote:string;staleThresholdDays:number};

function activityStatus(days:number|null) {return days===null?'Never contacted':days<=30?'0–30 days':days<=60?'31–60 days':days<=90?'61–90 days':'91+ days';}
function accountGroup(row:AccountDbRow, latest:AccountDbRow['activities'][number]|undefined, days:number|null, groupBy:string|null) {
  if(groupBy==='owner') return {key:String(row.ownerId??'none'),label:row.owner?`${row.owner.firstName} ${row.owner.lastName}`:'Unassigned'};
  if(groupBy==='industry') return {key:row.industry??'none',label:row.industryCategory?.name??row.industry??'No Industry'};
  if(groupBy==='territory') return {key:row.territory??'none',label:row.territoryCategory?.name??row.territory??'No Territory'};
  if(groupBy==='latestActivityType') return {key:latest?.type??'none',label:latest?.activityType.name??'No activity'};
  if(groupBy==='activityStatus') {const label=activityStatus(days);return {key:label,label};}
  return null;
}
export async function executeAccountActivityReport(client:PrismaClient, actor:Actor, rawConfig:unknown, now=new Date()):Promise<AccountActivityReportResult> {
  if(!canRunReportType(actor,'ACCOUNT_ACTIVITY')) throw new Error('Access denied');
  const config=validateReportConfiguration('ACCOUNT_ACTIVITY',rawConfig);
  const clauses:Prisma.AccountWhereInput[]=[engagementAccountWhere(actor)];
  for(const filter of config.filters) {
    const value=filter.value;
    if(filter.field==='ownerId')clauses.push({ownerId:value as number});
    else if(filter.field==='accountId')clauses.push({id:value as number});
    else if(filter.field==='industry')clauses.push({industry:value as string});
    else if(filter.field==='territory')clauses.push({territory:value as string});
    else if(filter.field==='strategicAccount')clauses.push({strategicAccount:value as boolean});
    else if(filter.field==='businessRole')clauses.push({businessRoles:{some:{role:value as never}}});
  }
  const [accounts,settings]=await Promise.all([client.account.findMany({where:{AND:clauses},include:{owner:true,industryCategory:true,territoryCategory:true,businessRoles:true,activities:{where:{archivedAt:null},include:{activityType:true,user:true},orderBy:latestAccountActivityOrder()}}}),getSettings(client)]);
  const staleThresholdDays=settings.STALE_ACCOUNT_WARNING_DAYS;
  const filtered=accounts.filter(row=>{const latest=row.activities[0], date=latest?.activityDate??null;return config.filters.every(filter=>filter.field==='minDays'?hasNoActivityInDays(date,filter.value as number,now):filter.field==='hasActivity'?Boolean(latest)===filter.value:filter.field==='activityType'?latest?.type===filter.value:true);});
  const enriched=filtered.map(row=>({row,latest:row.activities[0],days:daysSince(row.activities[0]?.activityDate??null,now)}));
  const sort=config.sort.length?config.sort:[{field:'lastActivity',direction:'asc' as const}];
  enriched.sort((a,b)=>{for(const spec of sort){const read=(item:typeof a):string|number=>spec.field==='account'?item.row.name:spec.field==='owner'?(item.row.owner?`${item.row.owner.lastName} ${item.row.owner.firstName}`:''):spec.field==='activityCount'?item.row.activities.length:spec.field==='daysSinceLastActivity'?(item.days??Number.MAX_SAFE_INTEGER):(item.latest?.activityDate.getTime()??Number.MIN_SAFE_INTEGER);const x=read(a),y=read(b),cmp=x<y?-1:x>y?1:0;if(cmp)return spec.direction==='asc'?cmp:-cmp;}return a.row.id-b.row.id;});
  const summarize=(items:typeof enriched):AccountActivityMetrics=>{const active=items.filter(x=>x.days!==null);return {accountCount:items.length,noActivityCount:items.length-active.length,staleAccountCount:items.filter(x=>hasNoActivityInDays(x.latest?.activityDate??null,staleThresholdDays,now)).length,activityCount:items.reduce((n,x)=>n+x.row.activities.length,0),averageDaysSinceLastActivity:active.length?Math.round(active.reduce((n,x)=>n+(x.days??0),0)/active.length*10)/10:null};};
  const groups=new Map<string,{key:string;label:string;items:typeof enriched}>();
  for(const item of enriched){const group=accountGroup(item.row,item.latest,item.days,config.groupBy);if(group){const found=groups.get(group.key)??{...group,items:[]};found.items.push(item);groups.set(group.key,found);}}
  return {reportType:'ACCOUNT_ACTIVITY',summary:summarize(enriched),groups:[...groups.values()].sort((a,b)=>a.label.localeCompare(b.label)).map(group=>({key:group.key,label:group.label,metrics:summarize(group.items),accountIds:group.items.map(x=>x.row.id)})),rows:enriched.map(({row,latest,days})=>({id:row.id,account:row.name,owner:row.owner?`${row.owner.firstName} ${row.owner.lastName}`:'Unassigned',industry:row.industryCategory?.name??row.industry??'—',territory:row.territoryCategory?.name??row.territory??'—',businessRoles:row.businessRoles.map(x=>x.role.replaceAll('_',' ')).join(', ')||'—',strategicAccount:row.strategicAccount,lastActivity:latest?.activityDate.toISOString().slice(0,16).replace('T',' ')??null,daysSinceLastActivity:days,activityStatus:activityStatus(days),latestActivityType:latest?.activityType.name??'—',latestActivityBy:latest?.user?`${latest.user.firstName} ${latest.user.lastName}`:'—',activityCount:row.activities.length,groupKeys:[accountGroup(row,latest,days,config.groupBy)?.key].filter((x):x is string=>!!x)})),filterCount:config.filters.length,semanticNote:accountActivityDefinition.semanticNote,staleThresholdDays};
}

export async function executeReport(client: PrismaClient, actor: Actor, reportType: unknown, rawConfig: unknown, now = new Date()) {
  if (!canRunReportType(actor,reportType)) throw new Error('Access denied');
  if (reportType === 'ACCOUNT_ACTIVITY') return executeAccountActivityReport(client,actor,rawConfig,now);
  if (reportType === 'PRODUCT_PERFORMANCE') return executeProductPerformanceReport(client,actor,rawConfig,now);
  if (reportType !== 'PIPELINE') { validateReportConfiguration(reportType,rawConfig); throw new Error('Report execution is not implemented.'); }
  return executePipelineReport(client,actor,rawConfig,now);
}
