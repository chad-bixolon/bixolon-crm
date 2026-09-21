import { ForecastCategory, ProductCatalogSource, Prisma, type PrismaClient } from '@prisma/client';
import { can, opportunityScope, type Actor } from './authorization';
import { lineTotal, opportunityTotal, weightedValue } from './opportunities';
import { daysSince, engagementAccountWhere, hasNoActivityInDays, latestAccountActivityOrder } from './engagement';
import { getSettings } from './configuration';
import { projectReadWhere } from './projects';
import { projectStatusLabels } from './project-labels';
import { canViewPriceException } from './price-exception-visibility';

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
    ownerId: { label: 'Sales rep', operators: ['eq'] }, activeSalesRep: { label: 'Active Sales Reps', operators: ['eq'] }, stageId: { label: 'Stage', operators: ['eq'] }, competitorId: { label: 'Competitor', operators: ['eq'] }, status: { label: 'Status', operators: ['eq'] },
    closeDate: { label: 'Close date', operators: ['preset','between'] }, createdDate: { label: 'Created date', operators: ['preset','between'] },
    accountId: { label: 'Participating Account', operators: ['eq'] }, accountOwnerId: { label: 'Account owner', operators: ['eq'] }, industry: { label: 'Industry', operators: ['eq'] }, territory: { label: 'Territory', operators: ['eq'] }, strategicAccount: { label: 'Strategic Account', operators: ['eq'] },
    participantRole: { label: 'Participant role', operators: ['eq'] }, forecastCategory: { label: 'Forecast Category', operators: ['eq'] }, productCategoryId: { label: 'Product Category', operators: ['eq'] }, productId: { label: 'Product', operators: ['eq'] }, skuId: { label: 'SKU', operators: ['eq'] }, projectId: { label: 'Project', operators: ['eq'] }, currency: { label: 'Currency', operators: ['eq'] },
  },
  columns: { opportunity: 'Opportunity', account: 'Account', owner: 'Owner', stage: 'Stage', closeDate: 'Close Date', value: 'Value', weightedValue: 'Weighted Value', currency: 'Currency' },
  groupings: { owner: 'Sales Rep', stage: 'Stage', competitor: 'Competitor', account: 'Account', industry: 'Industry', territory: 'Territory', productCategory: 'Product Category', project: 'Project' },
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
  label:'Product Performance', description:'Product and category opportunity performance', grain:'OpportunityProduct', implemented:true,
  semanticNote:'Each active product line contributes its own quantity × Opportunity unit price. Opportunity Count is distinct within each group; totals are separated by currency and SKU price unit. Lines without a SKU use Each.',
  filters:{ownerId:{label:'Sales Rep',operators:['eq']},stageId:{label:'Stage',operators:['eq']},forecastCategory:{label:'Forecast Category',operators:['eq']},status:{label:'Status',operators:['eq']},closeDate:{label:'Expected Close Date',operators:['preset','between']},accountId:{label:'Account',operators:['eq']},industry:{label:'Industry',operators:['eq']},territory:{label:'Territory',operators:['eq']},strategicAccount:{label:'Strategic Account',operators:['eq']},productCategoryId:{label:'Product Category',operators:['eq']},productId:{label:'Product',operators:['eq']},skuId:{label:'SKU',operators:['eq']},catalogSource:{label:'Catalog Source',operators:['eq']},odmCustomerAccountId:{label:'ODM Customer',operators:['eq']},priceSource:{label:'Pricing Source',operators:['eq']},projectId:{label:'Project',operators:['eq']},currency:{label:'Currency',operators:['eq']}},
  columns:{opportunity:'Opportunity',account:'Account',owner:'Owner',stage:'Stage',forecastCategory:'Forecast Category',closeDate:'Expected Close Date',productCategory:'Product Category',product:'Product / Model',sku:'SKU / Part Number',catalogSource:'Catalog Source',odmCustomer:'ODM Customer',quantity:'Quantity',unit:'Unit',unitPrice:'Unit Price',lineValue:'Line Value',priceSource:'Pricing Source',currency:'Currency',project:'Project',peCode:'PE #'},
  groupings:{productCategory:'Product Category',product:'Product / Model',sku:'SKU',catalogSource:'Catalog Source',odmCustomer:'ODM Customer',owner:'Sales Rep',account:'Account',stage:'Stage',forecastCategory:'Forecast Category',priceSource:'Pricing Source',project:'Project'},
  metrics:{lineValue:'Line Value',quantity:'Quantity',opportunityCount:'Opportunity Count',productLineCount:'Product Line Count',averageUnitPrice:'Average Unit Price'},
  sorts:{product:'Product / Model',sku:'SKU',quantity:'Quantity',lineValue:'Line Value',opportunityCount:'Opportunity Count',averageUnitPrice:'Average Unit Price',closeDate:'Expected Close Date',owner:'Sales Rep'},
};
const priceExceptionUsageDefinition: ReportTypeDefinition = {
  label:'Price Exception Usage Report',description:'Analyze approved pricing usage across Opportunities, Accounts, products, and the sales team.',grain:'OpportunityProduct',implemented:true,
  semanticNote:'Each PE-backed product line contributes quantity × actual Opportunity Product price. Historical approved price and MOQ come from the line snapshot. Totals are separated by currency and price unit; Opportunity and Price Exception counts are distinct within each total.',
  filters:{ownerId:{label:'Sales Rep',operators:['eq']},accountId:{label:'Account',operators:['eq']},opportunityId:{label:'Opportunity',operators:['eq']},stageId:{label:'Opportunity Stage',operators:['eq']},competitorId:{label:'Competitor',operators:['eq']},forecastCategory:{label:'Forecast Category',operators:['eq']},status:{label:'Status',operators:['eq']},closeDate:{label:'Expected Close Date',operators:['preset','between']},productId:{label:'Product',operators:['eq']},skuId:{label:'SKU',operators:['eq']},productCategoryId:{label:'Product Category',operators:['eq']},priceExceptionId:{label:'Price Exception',operators:['eq']},peSalespersonId:{label:'PE Salesperson',operators:['eq']},moqStatus:{label:'MOQ Status',operators:['eq']},overrideStatus:{label:'Override Status',operators:['eq']},currency:{label:'Currency',operators:['eq']}},
  columns:{opportunity:'Opportunity',account:'Account',owner:'Sales Rep',product:'Product',sku:'SKU',productCategory:'Product Category',quantity:'Quantity',peCode:'Price Exception',peSalesperson:'PE Salesperson',peMoq:'PE MOQ',approvedUnitPrice:'Approved PE Unit Price',unitPrice:'Actual Unit Price',overrideAmount:'Override Amount',overridePercent:'Override %',lineValue:'PE Line Value',moqStatus:'MOQ Status',stage:'Opportunity Stage',forecastCategory:'Forecast Category',closeDate:'Expected Close Date',currency:'Currency'},
  groupings:{owner:'Sales Rep',peSalesperson:'PE Salesperson',account:'Account',priceException:'Price Exception',product:'Product',productCategory:'Product Category',opportunity:'Opportunity',stage:'Opportunity Stage',forecastCategory:'Forecast Category',currency:'Currency'},
  metrics:{lineValue:'PE Line Value',quantity:'PE Quantity',opportunityCount:'PE Opportunity Count',productLineCount:'PE Product Line Count',priceExceptionCount:'Distinct Price Exceptions Used',averageApprovedUnitPrice:'Average Approved Unit Price',averageActualUnitPrice:'Average Actual Unit Price'},
  sorts:{lineValue:'PE Line Value',quantity:'Quantity',opportunity:'Opportunity',product:'Product',peCode:'Price Exception',closeDate:'Expected Close Date',owner:'Sales Rep'},
};

export const reportRegistry: Record<CuratedReportType, ReportTypeDefinition> = {
  PIPELINE: pipelineDefinition,
  ACCOUNT_ACTIVITY: accountActivityDefinition,
  PRODUCT_PERFORMANCE: productPerformanceDefinition,
  CHANNEL_PARTNER: {
    label:'Channel / Partner',description:'Distributor, reseller, and partner performance',grain:'Opportunity participant',implemented:true,
    semanticNote:'An Opportunity can involve more than one partner. Overall totals and each group count its value once, even when multiple partners in that group participate. Partner and role groups can overlap.',
    filters:{ownerId:{label:'Sales Rep',operators:['eq']},accountId:{label:'Partner Account',operators:['eq']},participantRole:{label:'Participant Role',operators:['eq']},status:{label:'Status',operators:['eq']},stageId:{label:'Stage',operators:['eq']},forecastCategory:{label:'Forecast Category',operators:['eq']},closeDate:{label:'Expected Close Date',operators:['preset','between']},industry:{label:'Industry',operators:['eq']},territory:{label:'Territory',operators:['eq']},strategicAccount:{label:'Strategic Account',operators:['eq']},productCategoryId:{label:'Product Category',operators:['eq']},projectId:{label:'Project',operators:['eq']},currency:{label:'Currency',operators:['eq']}},
    columns:{opportunity:'Opportunity',partner:'Partner Account',participantRoles:'Participant Roles',owner:'Owner',stage:'Stage',forecastCategory:'Forecast Category',closeDate:'Expected Close Date',value:'Opportunity Value',weightedValue:'Weighted Value',currency:'Currency',productCategories:'Product Categories',projects:'Projects'},
    groupings:{partner:'Partner Account',participantRole:'Participant Role',owner:'Sales Rep',industry:'Industry',territory:'Territory',productCategory:'Product Category',stage:'Stage',forecastCategory:'Forecast Category',project:'Project'},
    metrics:{pipeline:'Pipeline',weightedPipeline:'Weighted Pipeline',opportunityCount:'Opportunity Count',partnerCount:'Partner Count'},
    sorts:{partner:'Partner Account',opportunity:'Opportunity',owner:'Sales Rep',stage:'Stage',closeDate:'Expected Close Date',value:'Opportunity Value'},
  },
  PROJECT_INITIATIVE: {
    label:'Project',description:'Project status, linked Opportunities, and pipeline',grain:'Project',implemented:true,
    semanticNote:'Sales values come from linked Opportunities. If an Opportunity is linked to more than one Project, it is counted once in overall totals. Closed Won values are shown separately from open Pipeline.',
    filters:{projectOwnerId:{label:'Project Owner',operators:['eq']},projectStatus:{label:'Project Status',operators:['eq']},projectId:{label:'Project',operators:['eq']},primaryAccountId:{label:'Primary Account',operators:['eq']},participantAccountId:{label:'Participant Account',operators:['eq']},hasAccount:{label:'Has Account',operators:['eq']},hasOpportunities:{label:'Has Opportunities',operators:['eq']},startDate:{label:'Start Date',operators:['preset','between']},targetEndDate:{label:'Target End Date',operators:['preset','between','attention']},ownerId:{label:'Sales Rep',operators:['eq']},stageId:{label:'Opportunity Stage',operators:['eq']},competitorId:{label:'Competitor',operators:['eq']},forecastCategory:{label:'Forecast Category',operators:['eq']},status:{label:'Opportunity Status',operators:['eq']},closeDate:{label:'Expected Close Date',operators:['preset','between']},productCategoryId:{label:'Product Category',operators:['eq']},currency:{label:'Currency',operators:['eq']}},
    columns:{project:'Project',projectOwner:'Project Owner',projectStatus:'Project Status',primaryAccount:'Primary Account',participantAccounts:'Participant Accounts',startDate:'Start Date',targetEndDate:'Target End Date',opportunityCount:'Opportunities',pipeline:'Pipeline',weightedPipeline:'Weighted Pipeline',commit:'Commit',wonOpportunityValue:'Won Opportunity Value',currency:'Currency',productCategories:'Product Categories',partnerAccounts:'Partner / Channel Accounts',linkedOpportunities:'Opportunity Names'},
    groupings:{project:'Project',projectOwner:'Project Owner',projectStatus:'Project Status',primaryAccount:'Primary Account',participantAccount:'Participant Account',owner:'Sales Rep',productCategory:'Product Category',stage:'Opportunity Stage',forecastCategory:'Forecast Category',currency:'Currency'},
    metrics:{projectCount:'Project Count',pipeline:'Pipeline',weightedPipeline:'Weighted Pipeline',commit:'Commit',opportunityCount:'Opportunity Count',wonOpportunityValue:'Won Opportunity Value'},
    sorts:{project:'Project',projectOwner:'Project Owner',projectStatus:'Project Status',targetEndDate:'Target End Date',pipeline:'Pipeline',opportunityCount:'Opportunity Count'},
  },
  PRICE_EXCEPTION_USAGE: priceExceptionUsageDefinition,
};

export const builtInReportTypes = ['MY_OPEN_PIPELINE','PIPELINE_THIS_QUARTER','PIPELINE_BY_SALES_REP','ACCOUNT_ENGAGEMENT','PRODUCT_THIS_QUARTER','PIPELINE_BY_PRODUCT','PIPELINE_BY_PARTNER','PIPELINE_BY_PARTNER_TYPE','MEDIA_PARTNER_PIPELINE','ACTIVE_PROJECTS','PIPELINE_BY_PROJECT','PROJECTS_NEAR_TARGET','PE_USAGE_THIS_QUARTER','PE_USAGE_BY_SALES_REP','PE_USAGE_BY_PRODUCT','PRICE_OVERRIDES','PES_BELOW_MOQ'] as const;
export type BuiltInReportType = typeof builtInReportTypes[number];

export function canRunReportType(actor: Actor, reportType: unknown) {
  return reportTypes.includes(reportType as CuratedReportType) && reportRegistry[reportType as CuratedReportType].implemented && can(actor,reportType === 'ACCOUNT_ACTIVITY' ? 'sales.write' : 'sales.read');
}
export function getVisibleReportTypes(actor: Actor) { return reportTypes.filter(reportType=>canRunReportType(actor,reportType)); }
export function getCreatableReportTypes(actor: Actor) { return can(actor,'sales.write') ? getVisibleReportTypes(actor) : []; }
export function canViewBuiltInReport(actor: Actor, reportType: BuiltInReportType) {
  return reportType === 'ACCOUNT_ENGAGEMENT' ? canRunReportType(actor,'ACCOUNT_ACTIVITY') : ['PE_USAGE_THIS_QUARTER','PE_USAGE_BY_SALES_REP','PE_USAGE_BY_PRODUCT','PRICE_OVERRIDES','PES_BELOW_MOQ'].includes(reportType) ? getCreatableReportTypes(actor).includes('PRICE_EXCEPTION_USAGE') : ['ACTIVE_PROJECTS','PIPELINE_BY_PROJECT','PROJECTS_NEAR_TARGET'].includes(reportType) ? getCreatableReportTypes(actor).includes('PROJECT_INITIATIVE') : ['PIPELINE_BY_PARTNER','PIPELINE_BY_PARTNER_TYPE','MEDIA_PARTNER_PIPELINE'].includes(reportType) ? getCreatableReportTypes(actor).includes('CHANNEL_PARTNER') : reportType === 'PRODUCT_THIS_QUARTER' || reportType === 'PIPELINE_BY_PRODUCT' ? getCreatableReportTypes(actor).includes('PRODUCT_PERFORMANCE') : getCreatableReportTypes(actor).includes('PIPELINE');
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
const participantRoles = ['END_USER','VAR_RESELLER','DISTRIBUTOR','ISV_PARTNER','OEM','OTHER','MEDIA_PARTNER','SERVICE_PARTNER'] as const;
export const channelPartnerAccountRoles = ['DISTRIBUTOR','VAR','ISV','OEM','PARTNER','MEDIA_PARTNER'] as const;
export const channelPartnerParticipantRoles = ['DISTRIBUTOR','VAR_RESELLER','ISV_PARTNER','OEM','MEDIA_PARTNER','SERVICE_PARTNER'] as const;

function validFilterValue(filter: ReportFilter) {
  if (['ownerId','stageId','competitorId','accountId','accountOwnerId','productCategoryId','productId','skuId','odmCustomerAccountId','projectId','minDays','opportunityId','priceExceptionId','peSalespersonId'].includes(filter.field)) return positiveInteger(filter.value);
  if (filter.field === 'moqStatus') return ['MET','NOT_MET','UNKNOWN'].includes(String(filter.value));
  if (filter.field === 'overrideStatus') return ['APPLIED','NONE'].includes(String(filter.value));
  if (['projectOwnerId','primaryAccountId','participantAccountId'].includes(filter.field)) return positiveInteger(filter.value);
  if (['hasAccount','hasOpportunities'].includes(filter.field)) return typeof filter.value === 'boolean';
  if (filter.field === 'projectStatus') return ['PLANNING','ACTIVE','ON_HOLD','COMPLETED','CANCELLED'].includes(String(filter.value));
  if (filter.field === 'targetEndDate' && filter.operator === 'attention') return ['OVERDUE','NEXT_30_DAYS','NO_DATE'].includes(String(filter.value));
  if (filter.field === 'hasActivity') return typeof filter.value === 'boolean';
  if (filter.field === 'businessRole') return ['END_USER','DISTRIBUTOR','VAR','ISV','OEM','PARTNER','MEDIA_PARTNER'].includes(String(filter.value));
  if (filter.field === 'activityType') return typeof filter.value === 'string' && filter.value.length > 0 && filter.value.length <= 100;
  if (filter.field === 'strategicAccount') return typeof filter.value === 'boolean';
  if (filter.field === 'activeSalesRep') return filter.value === true;
  if (filter.field === 'status') return statuses.includes(filter.value as typeof statuses[number]);
  if (filter.field === 'priceSource') return ['MANUAL','CATALOG','PRICE_EXCEPTION'].includes(String(filter.value));
  if (filter.field === 'catalogSource') return Object.values(ProductCatalogSource).includes(filter.value as ProductCatalogSource);
  if (filter.field === 'participantRole') return participantRoles.includes(filter.value as typeof participantRoles[number]);
  if (filter.field === 'forecastCategory') return filter.value === 'IN_FORECAST' || Object.values(ForecastCategory).includes(filter.value as ForecastCategory);
  if (filter.field === 'accountBusinessRole') return channelPartnerAccountRoles.includes(filter.value as typeof channelPartnerAccountRoles[number]);
  if (['industry','territory'].includes(filter.field)) return typeof filter.value === 'string' && filter.value.length > 0 && filter.value.length <= 100;
  if (filter.field === 'currency') return typeof filter.value === 'string' && /^[A-Z]{3}$/.test(filter.value);
  if (['closeDate','createdDate','startDate','targetEndDate'].includes(filter.field) && filter.operator === 'preset') return presets.includes(filter.value as typeof presets[number]);
  if (['closeDate','createdDate','startDate','targetEndDate'].includes(filter.field) && filter.operator === 'between') return object(filter.value) && exactKeys(filter.value, ['from','to']) && dateString(filter.value.from) && dateString(filter.value.to) && String(filter.value.from) <= String(filter.value.to);
  return false;
}

export function defaultReportConfiguration(reportType: CuratedReportType): ReportConfiguration {
  if (reportType === 'PRICE_EXCEPTION_USAGE') return {filters:[],groupBy:'priceException',sort:[{field:'lineValue',direction:'desc'}],columns:['opportunity','account','owner','product','sku','productCategory','quantity','peCode','peSalesperson','peMoq','approvedUnitPrice','unitPrice','overrideAmount','overridePercent','lineValue','moqStatus','stage','forecastCategory','closeDate','currency'],metrics:['lineValue','quantity','opportunityCount','productLineCount','priceExceptionCount','averageApprovedUnitPrice','averageActualUnitPrice']};
  if (reportType === 'PROJECT_INITIATIVE') return {filters:[{field:'status',operator:'eq',value:'OPEN'}],groupBy:'project',sort:[{field:'pipeline',direction:'desc'}],columns:['project','projectOwner','projectStatus','primaryAccount','participantAccounts','startDate','targetEndDate','opportunityCount','pipeline','weightedPipeline','commit','currency','linkedOpportunities'],metrics:['projectCount','pipeline','weightedPipeline','commit','opportunityCount']};
  if (reportType === 'CHANNEL_PARTNER') return {filters:[{field:'status',operator:'eq',value:'OPEN'}],groupBy:'partner',sort:[{field:'value',direction:'desc'}],columns:['opportunity','partner','participantRoles','owner','stage','closeDate','value','weightedValue','currency'],metrics:['pipeline','weightedPipeline','opportunityCount','partnerCount']};
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
    else if (filter.field === 'competitorId') clauses.push({ competitorId: value as number });
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

const projectInclude = {owner:true,primaryAccount:true,participants:{include:{account:true}},opportunities:{include:{opportunity:{include:{owner:true,stage:true,participants:{include:{account:true,roles:true}},products:{where:{archivedAt:null},include:{product:{include:{category:true}}}}}}}}} as const;
type ProjectDbRow = Prisma.ProjectGetPayload<{include:typeof projectInclude}>;
type ProjectOpportunity = ProjectDbRow['opportunities'][number]['opportunity'];
export type ProjectMetrics = {currency:string|null;projectCount:number;opportunityCount:number;pipeline:string;weightedPipeline:string;commit:string;wonOpportunityValue:string};
export type ProjectDetailRow = {id:number;project:string;projectOwner:string;projectStatus:string;primaryAccount:{id:number;name:string}|null;participantAccounts:{id:number;name:string}[];startDate:string|null;targetEndDate:string|null;opportunityCount:number;amounts:ProjectMetrics[];productCategories:string;partnerAccounts:{id:number;name:string}[];linkedOpportunities:{id:number;name:string;currency:string}[];groupKeys:string[]};
export type ProjectReportResult = {reportType:'PROJECT_INITIATIVE';summary:ProjectMetrics[];groups:{key:string;label:string;metrics:ProjectMetrics[];contributions:{projectId:number;amounts:ProjectMetrics[];opportunityIds:number[]}[]}[];rows:ProjectDetailRow[];currencies:string[];semanticNote:string};
const projectName=(owner:{firstName:string;lastName:string}|null)=>owner?`${owner.firstName} ${owner.lastName}`:'Unassigned';
function uniqueOpportunities(items:ProjectOpportunity[]) {return [...new Map(items.map(item=>[item.id,item])).values()];}
function projectMetrics(projects:ProjectDbRow[], items:ProjectOpportunity[]):ProjectMetrics[] {
  const unique=uniqueOpportunities(items);
  const currencies:(string|null)[]=[...new Set(unique.map(item=>item.currencyCode))].sort();
  if(!currencies.length)currencies.push(null);
  return currencies.map(currency=>{
    const selected=unique.filter(item=>item.currencyCode===currency);
    const amount=(kind:'pipeline'|'weightedPipeline'|'commit'|'wonOpportunityValue')=>selected.reduce((sum,item)=>{
      const value=opportunityTotal(item.products);
      return sum.add(kind==='weightedPipeline'?(!item.stage.isClosed?weightedValue(value,item.probability??item.stage.probability):new Prisma.Decimal(0)):kind==='commit'?(item.forecastCategory==='COMMIT'&&!item.stage.isClosed?value:new Prisma.Decimal(0)):kind==='wonOpportunityValue'?(item.stage.isClosed&&item.stage.isWon?value:new Prisma.Decimal(0)):!item.stage.isClosed?value:new Prisma.Decimal(0));
    },new Prisma.Decimal(0)).toFixed(2);
    return {currency,projectCount:new Set(projects.map(project=>project.id)).size,opportunityCount:selected.length,pipeline:amount('pipeline'),weightedPipeline:amount('weightedPipeline'),commit:amount('commit'),wonOpportunityValue:amount('wonOpportunityValue')};
  });
}
function projectGroups(project:ProjectDbRow, groupBy:string|null):{key:string;label:string;items:ProjectOpportunity[]}[] {
  const all=uniqueOpportunities(project.opportunities.map(link=>link.opportunity));
  const one=(key:string,label:string)=>[{key,label,items:all}];
  if(groupBy==='project')return one(String(project.id),project.name);
  if(groupBy==='projectOwner')return one(String(project.ownerId??'none'),projectName(project.owner));
  if(groupBy==='projectStatus')return one(project.status,projectStatusLabels[project.status]);
  if(groupBy==='primaryAccount')return one(String(project.primaryAccountId??'none'),project.primaryAccount?.name??'No Primary Account');
  if(groupBy==='participantAccount')return project.participants.length?project.participants.map(p=>({key:String(p.accountId),label:p.account.name,items:all})):one('none','No Participant Account');
  const map=new Map<string,{key:string;label:string;items:ProjectOpportunity[]}>();
  for(const item of all){
    let values:{key:string;label:string}[]=[];
    if(groupBy==='owner')values=[{key:String(item.ownerId??'none'),label:projectName(item.owner)}];
    if(groupBy==='stage')values=[{key:String(item.stageId),label:item.stage.name}];
    if(groupBy==='forecastCategory')values=[{key:item.forecastCategory,label:item.forecastCategory.replaceAll('_',' ')}];
    if(groupBy==='currency')values=[{key:item.currencyCode,label:item.currencyCode}];
    if(groupBy==='productCategory')values=item.products.length?[...new Map(item.products.map(p=>[String(p.product.categoryId??'none'),{key:String(p.product.categoryId??'none'),label:p.product.category?.name??'No Product Category'}])).values()]:[{key:'none',label:'No Product Category'}];
    for(const value of values){const found=map.get(value.key)??{...value,items:[]};found.items.push(item);map.set(value.key,found);}
  }
  return map.size?[...map.values()]:one('none','No Opportunities');
}
export async function executeProjectInitiativeReport(client:PrismaClient,actor:Actor,rawConfig:unknown,now=new Date()):Promise<ProjectReportResult>{
  if(!canRunReportType(actor,'PROJECT_INITIATIVE')||!can(actor,'projects.read'))throw new Error('Access denied');
  const config=validateReportConfiguration('PROJECT_INITIATIVE',rawConfig);
  const projectClauses:Prisma.ProjectWhereInput[]=[{archivedAt:null},projectReadWhere(actor)];
  const opportunityFilters=config.filters.filter(f=>['ownerId','stageId','competitorId','forecastCategory','status','closeDate','productCategoryId','currency'].includes(f.field));
  for(const filter of config.filters){const value=filter.value;
    if(filter.field==='projectOwnerId')projectClauses.push({ownerId:value as number});
    else if(filter.field==='projectStatus')projectClauses.push({status:value as never});
    else if(filter.field==='projectId')projectClauses.push({id:value as number});
    else if(filter.field==='primaryAccountId')projectClauses.push({primaryAccountId:value as number});
    else if(filter.field==='participantAccountId')projectClauses.push({participants:{some:{accountId:value as number}}});
    else if(filter.field==='hasAccount')projectClauses.push(value?{OR:[{primaryAccountId:{not:null}},{participants:{some:{}}}]}:{primaryAccountId:null,participants:{none:{}}});
    else if(filter.field==='hasOpportunities')projectClauses.push({opportunities:value?{some:{opportunity:{archivedAt:null}}}:{none:{opportunity:{archivedAt:null}}}});
    else if(filter.field==='startDate'||filter.field==='targetEndDate'){
      let bounds:Prisma.DateTimeNullableFilter;
      if(filter.operator==='attention'){
        const {year,month,day}=easternParts(now),today=new Date(Date.UTC(year,month-1,day));
        bounds=value==='NO_DATE'?{equals:null}:value==='OVERDUE'?{lt:today}:{gte:today,lt:new Date(today.getTime()+30*86400000)};
        if(value==='OVERDUE')projectClauses.push({status:{notIn:['COMPLETED','CANCELLED']}});
      }else bounds=filter.operator==='preset'?reportDatePreset(value as typeof presets[number],now):{gte:new Date(`${(value as {from:string}).from}T00:00:00Z`),lt:new Date(new Date(`${(value as {to:string}).to}T00:00:00Z`).getTime()+86400000)};
      projectClauses.push(filter.field==='startDate'?{startDate:bounds}:{targetEndDate:bounds});
    }
  }
  const opportunityWhere=pipelineWhere({...config,filters:opportunityFilters},actor,now);
  if(opportunityFilters.some(filter=>filter.field!=='status'||filter.value!=='OPEN'))projectClauses.push({opportunities:{some:{opportunity:opportunityWhere}}});
  const projects=await client.project.findMany({where:{AND:projectClauses},include:{...projectInclude,opportunities:{...projectInclude.opportunities,where:{opportunity:opportunityWhere}}}});
  const all=projects.flatMap(project=>project.opportunities.map(link=>link.opportunity));
  const groups=new Map<string,{key:string;label:string;projects:ProjectDbRow[];items:ProjectOpportunity[];contributions:{projectId:number;amounts:ProjectMetrics[];opportunityIds:number[]}[]}>();
  for(const project of projects)for(const group of projectGroups(project,config.groupBy)){const found=groups.get(group.key)??{key:group.key,label:group.label,projects:[],items:[],contributions:[]};found.projects.push(project);found.items.push(...group.items);found.contributions.push({projectId:project.id,amounts:projectMetrics([project],group.items),opportunityIds:group.items.map(item=>item.id)});groups.set(group.key,found);}
  const sort=config.sort[0];
  const sorted=[...projects].sort((a,b)=>{const read=(p:ProjectDbRow)=>sort?.field==='projectOwner'?projectName(p.owner):sort?.field==='projectStatus'?p.status:sort?.field==='targetEndDate'?(p.targetEndDate?.getTime()??Number.MAX_SAFE_INTEGER):sort?.field==='opportunityCount'?p.opportunities.length:sort?.field==='pipeline'?p.opportunities.reduce((v,l)=>v+opportunityTotal(l.opportunity.products).toNumber(),0):p.name;const x=read(a),y=read(b),n=x<y?-1:x>y?1:0;return (sort?.direction==='desc'?-n:n)||a.id-b.id;});
  return {reportType:'PROJECT_INITIATIVE',summary:projectMetrics(projects,all),groups:[...groups.values()].sort((a,b)=>a.label.localeCompare(b.label)).map(group=>({key:group.key,label:group.label,metrics:projectMetrics(group.projects,group.items),contributions:group.contributions})),rows:sorted.map(project=>{const items=uniqueOpportunities(project.opportunities.map(link=>link.opportunity));return {id:project.id,project:project.name,projectOwner:projectName(project.owner),projectStatus:projectStatusLabels[project.status],primaryAccount:project.primaryAccount?{id:project.primaryAccount.id,name:project.primaryAccount.name}:null,participantAccounts:project.participants.map(p=>({id:p.accountId,name:p.account.name})),startDate:project.startDate?.toISOString().slice(0,10)??null,targetEndDate:project.targetEndDate?.toISOString().slice(0,10)??null,opportunityCount:items.length,amounts:projectMetrics([project],items),productCategories:[...new Set(items.flatMap(item=>item.products.map(p=>p.product.category?.name??'No Product Category')))].join(', ')||'—',partnerAccounts:[...new Map(items.flatMap(item=>item.participants.filter(p=>p.roles.some(r=>channelPartnerParticipantRoles.includes(r.role as typeof channelPartnerParticipantRoles[number]))).map(p=>[p.accountId,{id:p.accountId,name:p.account.name}] as const))).values()],linkedOpportunities:items.map(item=>({id:item.id,name:item.name,currency:item.currencyCode})),groupKeys:projectGroups(project,config.groupBy).map(group=>group.key)};}),currencies:[...new Set(all.map(item=>item.currencyCode))].sort(),semanticNote:reportRegistry.PROJECT_INITIATIVE.semanticNote};
}

type PipelineDbRow = Prisma.OpportunityGetPayload<{ include: { stage: true; competitor: true; owner: true; participants: { include: { account: { include: { owner: true; industryCategory: true; territoryCategory: true } }; roles: true } }; products: { include: { product: { include: { category: true } }; sku: true } }; projects: { include: { project: { include: { owner: true } } } } } }>;
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
  if (groupBy === 'competitor') return [{ key:String(row.competitorId??'none'), label:row.competitor?.name??'No competitor selected' }];
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
  const rows=sortRows(await client.opportunity.findMany({ where:pipelineWhere(config,actor,now), include:{ stage:true, competitor:true, owner:true, participants:{include:{account:{include:{owner:true,industryCategory:true,territoryCategory:true}},roles:true}}, products:{where:{archivedAt:null},include:{product:{include:{category:true}},sku:true}}, projects:{include:{project:{include:{owner:true}}}} } }),config.sort);
  const groups=new Map<string,{key:string;label:string;rows:PipelineDbRow[]}>();
  for(const row of rows) for(const group of groupValues(row,config.groupBy)){ const existing=groups.get(group.key)??{...group,rows:[]}; if(!existing.rows.some(item=>item.id===row.id))existing.rows.push(row); groups.set(group.key,existing); }
  return { reportType:'PIPELINE', summary:metrics(rows), groups:[...groups.values()].sort((a,b)=>a.label.localeCompare(b.label)).map(group=>({key:group.key,label:group.label,metrics:metrics(group.rows),opportunityIds:group.rows.map(row=>row.id)})), rows:rows.map(row=>{const value=opportunityTotal(row.products),probability=row.probability??row.stage.probability; return {id:row.id,opportunity:row.name,accounts:row.participants.map(x=>x.account.name).sort().join(', ')||'—',owner:row.owner?`${row.owner.firstName} ${row.owner.lastName}`:'Unassigned',stage:row.stage.name,forecastCategory:row.forecastCategory,closeDate:row.expectedCloseDate?.toISOString().slice(0,10)??null,value:value.toFixed(2),weightedValue:weightedValue(value,probability).toFixed(2),probability,currency:row.currencyCode,groupKeys:groupValues(row,config.groupBy).map(x=>x.key)};}), currencies:[...new Set(rows.map(row=>row.currencyCode))].sort(), filterCount:config.filters.length, semanticNote:pipelineDefinition.semanticNote };
}

const channelRoleLabels:Record<string,string>={DISTRIBUTOR:'Distributor',VAR_RESELLER:'VAR / Reseller',ISV_PARTNER:'ISV',OEM:'OEM',MEDIA_PARTNER:'Media Partner',SERVICE_PARTNER:'Service Partner',END_USER:'End User',OTHER:'Other'};
type ChannelMember={opportunity:PipelineDbRow;participant:PipelineDbRow['participants'][number];roles:string[];groupKeys:string[]};
export type ChannelMetrics={currency:string;pipeline:string;weightedPipeline:string;opportunityCount:number;partnerCount:number};
export type ChannelDetailRow={id:string;opportunityId:number;accountId:number;opportunity:string;partner:string;participantRoles:string;owner:string;stage:string;forecastCategory:string;closeDate:string|null;value:string;weightedValue:string;probability:number;currency:string;productCategories:string;projects:string;groupKeys:string[]};
export type ChannelReportResult={reportType:'CHANNEL_PARTNER';summary:ChannelMetrics[];groups:{key:string;label:string;metrics:ChannelMetrics[]}[];rows:ChannelDetailRow[];currencies:string[];semanticNote:string};

function channelGroups(member:ChannelMember,groupBy:string|null):{key:string;label:string}[]{
  const {opportunity:row,participant}=member;
  if(groupBy==='partner')return [{key:String(participant.accountId),label:participant.account.name}];
  if(groupBy==='participantRole')return member.roles.map(role=>({key:role,label:channelRoleLabels[role]??role}));
  if(groupBy==='owner')return [{key:String(row.ownerId??'none'),label:row.owner?`${row.owner.firstName} ${row.owner.lastName}`:'Unassigned'}];
  if(groupBy==='industry')return [{key:participant.account.industry??'none',label:participant.account.industryCategory?.name??participant.account.industry??'No Industry'}];
  if(groupBy==='territory')return [{key:participant.account.territory??'none',label:participant.account.territoryCategory?.name??participant.account.territory??'No Territory'}];
  if(groupBy==='stage')return [{key:String(row.stageId),label:row.stage.name}];
  if(groupBy==='forecastCategory')return [{key:row.forecastCategory,label:row.forecastCategory.replaceAll('_',' ')}];
  if(groupBy==='productCategory')return row.products.length?[...new Map(row.products.map(product=>[String(product.product.categoryId??'none'),{key:String(product.product.categoryId??'none'),label:product.product.category?.name??'No Product Category'}])).values()]:[{key:'none',label:'No Product Category'}];
  if(groupBy==='project')return row.projects.length?row.projects.map(project=>({key:String(project.projectId),label:project.project.name})):[{key:'none',label:'No Project'}];
  return [];
}
function channelMetrics(members:ChannelMember[]):ChannelMetrics[]{
  return [...new Set(members.map(member=>member.opportunity.currencyCode))].sort().map(currency=>{
    const selected=members.filter(member=>member.opportunity.currencyCode===currency);
    const opportunities=[...new Map(selected.map(member=>[member.opportunity.id,member.opportunity])).values()];
    const pipeline=opportunities.reduce((sum,row)=>sum.add(opportunityTotal(row.products)),new Prisma.Decimal(0));
    const weighted=opportunities.reduce((sum,row)=>sum.add(weightedValue(opportunityTotal(row.products),row.probability??row.stage.probability)),new Prisma.Decimal(0));
    return {currency,pipeline:pipeline.toFixed(2),weightedPipeline:weighted.toFixed(2),opportunityCount:opportunities.length,partnerCount:new Set(selected.map(member=>member.participant.accountId)).size};
  });
}
export async function executeChannelPartnerReport(client:PrismaClient,actor:Actor,rawConfig:unknown,now=new Date()):Promise<ChannelReportResult>{
  if(!canRunReportType(actor,'CHANNEL_PARTNER'))throw new Error('Access denied');
  const config=validateReportConfiguration('CHANNEL_PARTNER',rawConfig);
  const partnerFields=new Set(['accountId','participantRole','industry','territory','strategicAccount']);
  const opportunityConfig={...config,filters:config.filters.filter(filter=>!partnerFields.has(filter.field))};
  const opportunities:PipelineDbRow[]=await client.opportunity.findMany({where:pipelineWhere(opportunityConfig,actor,now),include:{stage:true,competitor:true,owner:true,participants:{include:{account:{include:{owner:true,industryCategory:true,territoryCategory:true}},roles:true}},products:{where:{archivedAt:null},include:{product:{include:{category:true}},sku:true}},projects:{include:{project:{include:{owner:true}}}}}});
  const filters=Object.fromEntries(config.filters.map(filter=>[filter.field,filter.value]));
  const members:ChannelMember[]=[];
  for(const opportunity of opportunities)for(const participant of opportunity.participants){
    const roles=participant.roles.map(role=>role.role).filter(role=>filters.participantRole?role===filters.participantRole:channelPartnerParticipantRoles.includes(role as typeof channelPartnerParticipantRoles[number]));
    if(!roles.length||filters.accountId&&participant.accountId!==filters.accountId||filters.industry&&participant.account.industry!==filters.industry||filters.territory&&participant.account.territory!==filters.territory||filters.strategicAccount!==undefined&&participant.account.strategicAccount!==filters.strategicAccount)continue;
    const member={opportunity,participant,roles,groupKeys:[]} as ChannelMember;
    member.groupKeys=[...new Set(channelGroups(member,config.groupBy).map(group=>group.key))];members.push(member);
  }
  const groups=new Map<string,{key:string;label:string;members:ChannelMember[]}>();
  for(const member of members)for(const group of channelGroups(member,config.groupBy)){const found=groups.get(group.key)??{...group,members:[]};if(!found.members.includes(member))found.members.push(member);groups.set(group.key,found);}
  const read=(member:ChannelMember,field:string):string|number=>{const row=member.opportunity;return field==='partner'?member.participant.account.name:field==='opportunity'?row.name:field==='owner'?row.owner?.lastName??'':field==='stage'?row.stage.name:field==='closeDate'?row.expectedCloseDate?.getTime()??Number.MAX_SAFE_INTEGER:opportunityTotal(row.products).toNumber();};
  members.sort((a,b)=>{for(const sort of config.sort){const left=read(a,sort.field),right=read(b,sort.field),order=left<right?-1:left>right?1:0;if(order)return sort.direction==='asc'?order:-order;}return a.opportunity.id-b.opportunity.id||a.participant.accountId-b.participant.accountId;});
  const rows=members.map(({opportunity:row,participant,groupKeys}):ChannelDetailRow=>{const value=opportunityTotal(row.products),probability=row.probability??row.stage.probability;return {id:`${row.id}:${participant.accountId}`,opportunityId:row.id,accountId:participant.accountId,opportunity:row.name,partner:participant.account.name,participantRoles:participant.roles.map(item=>channelRoleLabels[item.role]??item.role).join(', '),owner:row.owner?`${row.owner.firstName} ${row.owner.lastName}`:'Unassigned',stage:row.stage.name,forecastCategory:row.forecastCategory.replaceAll('_',' '),closeDate:row.expectedCloseDate?.toISOString().slice(0,10)??null,value:value.toFixed(2),weightedValue:weightedValue(value,probability).toFixed(2),probability,currency:row.currencyCode,productCategories:[...new Set(row.products.map(product=>product.product.category?.name??'No Product Category'))].join(', ')||'—',projects:[...new Set(row.projects.map(project=>project.project.name))].join(', ')||'—',groupKeys};});
  return {reportType:'CHANNEL_PARTNER',summary:channelMetrics(members),groups:[...groups.values()].sort((a,b)=>a.label.localeCompare(b.label)).map(group=>({key:group.key,label:group.label,metrics:channelMetrics(group.members)})),rows,currencies:[...new Set(members.map(member=>member.opportunity.currencyCode))].sort(),semanticNote:reportRegistry.CHANNEL_PARTNER.semanticNote};
}

const productLineInclude = {product:{select:{name:true,sku:true,categoryId:true,category:{select:{name:true}}}},sku:{select:{partNumber:true,priceUnit:true,catalogSource:true,odmCustomerAccountId:true,odmCustomerAccount:{select:{name:true}}}},opportunity:{select:{name:true,ownerId:true,owner:{select:{firstName:true,lastName:true}},stageId:true,stage:{select:{name:true}},forecastCategory:true,expectedCloseDate:true,currencyCode:true,participants:{select:{accountId:true,account:{select:{name:true}}}},projects:{select:{projectId:true,project:{select:{name:true}}}}}}} as const;
type ProductLineDbRow = Prisma.OpportunityProductGetPayload<{include:typeof productLineInclude}>;
export type ProductMetrics = {currency:string;unit:string;lineValue:string;quantity:number;opportunityCount:number;productLineCount:number;averageUnitPrice:string};
export type ProductDetailRow = {id:number;opportunityId:number;opportunity:string;accounts:{id:number;name:string}[];owner:string;stage:string;forecastCategory:string;closeDate:string|null;productCategory:string;product:string;productId:number;sku:string;catalogSource:string;odmCustomer:string;quantity:number;unit:string;unitPrice:string;lineValue:string;priceSource:string;currency:string;project:string;peCode:string;groupKeys:string[]};
export type ProductPerformanceResult = {reportType:'PRODUCT_PERFORMANCE';summary:ProductMetrics[];groups:{key:string;label:string;metrics:ProductMetrics[];lineIds:number[]}[];rows:ProductDetailRow[];currencies:string[];filterCount:number;semanticNote:string};
const priceSourceLabel = (source:string) => source==='PRICE_EXCEPTION'?'Price Exception':source==='CATALOG'?'Catalog':'Manual';
function productGroupValues(row:ProductLineDbRow, groupBy:string|null):{key:string;label:string}[] {
  const opportunity=row.opportunity;
  if(groupBy==='productCategory')return [{key:String(row.product.categoryId??'none'),label:row.product.category?.name??'No Product Category'}];
  if(groupBy==='product')return [{key:String(row.productId),label:row.product.name}];
  if(groupBy==='sku')return [{key:String(row.skuId??`legacy-${row.productId}`),label:row.sku?.partNumber??row.product.sku}];
  if(groupBy==='catalogSource')return [{key:row.sku?.catalogSource??'none',label:row.sku?.catalogSource==='ODM'?'ODM':row.sku?.catalogSource?.replaceAll('_',' ')??'Unclassified'}];
  if(groupBy==='odmCustomer')return row.sku?.catalogSource==='ODM'?[{key:String(row.sku.odmCustomerAccountId??'none'),label:row.sku.odmCustomerAccount?.name??'Unresolved ODM Customer'}]:[{key:'not-odm',label:'Not ODM'}];
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
  const opportunityConfig={...config,filters:config.filters.filter(filter=>!['productCategoryId','productId','skuId','catalogSource','odmCustomerAccountId','priceSource'].includes(filter.field))};
  const lineClauses:Prisma.OpportunityProductWhereInput[]=[{archivedAt:null},{opportunity:pipelineWhere(opportunityConfig,actor,now)}];
  for(const filter of config.filters){
    if(filter.field==='productCategoryId')lineClauses.push({product:{categoryId:filter.value as number}});
    else if(filter.field==='productId')lineClauses.push({productId:filter.value as number});
    else if(filter.field==='skuId')lineClauses.push({skuId:filter.value as number});
    else if(filter.field==='priceSource')lineClauses.push({priceSource:filter.value as never});
    else if(filter.field==='catalogSource')lineClauses.push({sku:{catalogSource:filter.value as ProductCatalogSource}});
    else if(filter.field==='odmCustomerAccountId')lineClauses.push({sku:{odmCustomerAccountId:filter.value as number}});
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
  return {reportType:'PRODUCT_PERFORMANCE',summary:productMetrics(rows),groups:sortedGroups.map(group=>({key:group.key,label:group.label,metrics:productMetrics(group.rows),lineIds:group.rows.map(row=>row.id)})),rows:rows.map(row=>({id:row.id,opportunityId:row.opportunityId,opportunity:row.opportunity.name,accounts:row.opportunity.participants.map(x=>({id:x.accountId,name:x.account.name})).sort((a,b)=>a.name.localeCompare(b.name)),owner:row.opportunity.owner?`${row.opportunity.owner.firstName} ${row.opportunity.owner.lastName}`:'Unassigned',stage:row.opportunity.stage.name,forecastCategory:row.opportunity.forecastCategory,closeDate:row.opportunity.expectedCloseDate?.toISOString().slice(0,10)??null,productCategory:row.product.category?.name??'No Product Category',product:row.product.name,productId:row.productId,sku:row.sku?.partNumber??row.product.sku,catalogSource:row.sku?.catalogSource==='ODM'?'ODM':row.sku?.catalogSource?.replaceAll('_',' ')??'Unclassified',odmCustomer:row.sku?.odmCustomerAccount?.name??'—',quantity:row.quantity,unit:row.sku?.priceUnit??'EACH',unitPrice:new Prisma.Decimal(row.estimatedUnitPrice).toFixed(2),lineValue:lineTotal(row).toFixed(2),priceSource:priceSourceLabel(row.priceSource),currency:row.opportunity.currencyCode,project:row.opportunity.projects.map(x=>x.project.name).join(', ')||'—',peCode:row.priceSource==='PRICE_EXCEPTION'?(row.priceExceptionCode??'—'):'—',groupKeys:productGroupValues(row,config.groupBy).map(x=>x.key)})),currencies:[...new Set(rows.map(row=>row.opportunity.currencyCode))].sort(),filterCount:config.filters.length,semanticNote:productPerformanceDefinition.semanticNote};
}

const peUsageInclude={...productLineInclude,priceExceptionLine:{select:{priceExceptionId:true,priceException:{select:{assignedSalesRepUserId:true,sourceType:true,assignedSalesRepUser:{select:{firstName:true,lastName:true}}}}}}} as const;
type PeUsageDbRow=Prisma.OpportunityProductGetPayload<{include:typeof peUsageInclude}>;
export type PeUsageMetrics={currency:string;unit:string;lineValue:string;quantity:number;opportunityCount:number;productLineCount:number;priceExceptionCount:number;averageApprovedUnitPrice:string|null;averageActualUnitPrice:string|null;utilizationPercent:string|null};
export type PeUsageDetailRow={id:number;opportunityId:number;opportunity:string;accounts:{id:number;name:string}[];owner:string;productId:number;product:string;sku:string;productCategory:string;quantity:number;peCode:string;priceExceptionId:number|null;peDetailAvailable:boolean;peSalesperson:string;peMoq:string|null;approvedUnitPrice:string|null;unitPrice:string;overrideAmount:string|null;overridePercent:string|null;lineValue:string;moqStatus:string;overrideApplied:boolean|null;stage:string;forecastCategory:string;closeDate:string|null;currency:string;unit:string;groupKeys:string[]};
export type PeUsageResult={reportType:'PRICE_EXCEPTION_USAGE';overall:{opportunityCount:number;productLineCount:number;priceExceptionCount:number};summary:PeUsageMetrics[];groups:{key:string;label:string;metrics:PeUsageMetrics[];lineIds:number[]}[];rows:PeUsageDetailRow[];currencies:string[];semanticNote:string};
function peMoq(row:PeUsageDbRow):Prisma.Decimal|null {const raw=row.priceExceptionSourceQty;if(!raw)return null;try {const value=new Prisma.Decimal(raw);return value.isFinite()?value:null;}catch{return null;}}
function peOverride(row:PeUsageDbRow):boolean|null {return row.priceExceptionUnitPrice===null?null:!new Prisma.Decimal(row.estimatedUnitPrice).toDecimalPlaces(2).equals(new Prisma.Decimal(row.priceExceptionUnitPrice).toDecimalPlaces(2));}
function peKey(row:PeUsageDbRow){return row.priceExceptionLine?.priceExceptionId?`id:${row.priceExceptionLine.priceExceptionId}`:row.priceExceptionCode?`code:${row.priceExceptionCode}`:row.priceExceptionLineId?`line:${row.priceExceptionLineId}`:null;}
function peGroupValues(row:PeUsageDbRow,groupBy:string|null){const pe=row.priceExceptionLine?.priceException;const one=(key:string,label:string)=>[{key,label}];if(groupBy==='priceException')return one(peKey(row)??'unknown',row.priceExceptionCode??'Unnumbered Price Exception');if(groupBy==='peSalesperson')return one(pe?.assignedSalesRepUserId?`user:${pe.assignedSalesRepUserId}`:'none',pe?.assignedSalesRepUser?`${pe.assignedSalesRepUser.firstName} ${pe.assignedSalesRepUser.lastName}`:'Unassigned');if(groupBy==='opportunity')return one(String(row.opportunityId),row.opportunity.name);if(groupBy==='currency')return one(row.opportunity.currencyCode,row.opportunity.currencyCode);return productGroupValues(row,groupBy);}
function peMetrics(rows:PeUsageDbRow[],denominators:Map<string,Prisma.Decimal>,includeEmpty=false):PeUsageMetrics[]{return [...new Set([...(includeEmpty?denominators.keys():[]),...rows.map(row=>`${row.opportunity.currencyCode}|${row.sku?.priceUnit??'EACH'}`)])].sort().map(key=>{const [currency,unit]=key.split('|'),selected=rows.filter(row=>row.opportunity.currencyCode===currency&&(row.sku?.priceUnit??'EACH')===unit);const value=selected.reduce((sum,row)=>sum.add(lineTotal(row)),new Prisma.Decimal(0));const quantity=selected.reduce((sum,row)=>sum+row.quantity,0);const approved=selected.filter(row=>row.priceExceptionUnitPrice!==null);const approvedQty=approved.reduce((sum,row)=>sum+row.quantity,0);const approvedValue=approved.reduce((sum,row)=>sum.add(new Prisma.Decimal(row.priceExceptionUnitPrice!).mul(row.quantity)),new Prisma.Decimal(0));const denominator=denominators.get(key);return {currency,unit,lineValue:value.toFixed(2),quantity,opportunityCount:new Set(selected.map(row=>row.opportunityId)).size,productLineCount:selected.length,priceExceptionCount:new Set(selected.map(peKey).filter(Boolean)).size,averageApprovedUnitPrice:approvedQty?approvedValue.div(approvedQty).toFixed(2):null,averageActualUnitPrice:quantity?value.div(quantity).toFixed(2):null,utilizationPercent:denominator&&!denominator.isZero()?value.div(denominator).mul(100).toFixed(2):null};});}
export async function executePriceExceptionUsageReport(client:PrismaClient,actor:Actor,rawConfig:unknown,now=new Date()):Promise<PeUsageResult>{
  if(!canRunReportType(actor,'PRICE_EXCEPTION_USAGE'))throw new Error('Access denied');const config=validateReportConfiguration('PRICE_EXCEPTION_USAGE',rawConfig);
  const lineFields=new Set(['productId','skuId','productCategoryId','priceExceptionId','peSalespersonId','moqStatus','overrideStatus']);
  const opportunityFilters=config.filters.filter(filter=>!lineFields.has(filter.field)&&filter.field!=='opportunityId');
  const opportunityWhere:Prisma.OpportunityWhereInput={AND:[pipelineWhere({...config,filters:opportunityFilters},actor,now),...config.filters.filter(x=>x.field==='opportunityId').map(x=>({id:x.value as number}))]};
  const common:Prisma.OpportunityProductWhereInput[]=[{archivedAt:null},{opportunity:opportunityWhere}];
  for(const filter of config.filters){if(filter.field==='productId')common.push({productId:filter.value as number});else if(filter.field==='skuId')common.push({skuId:filter.value as number});else if(filter.field==='productCategoryId')common.push({product:{categoryId:filter.value as number}});}
  const where:Prisma.OpportunityProductWhereInput[]=[...common,{OR:[{priceSource:'PRICE_EXCEPTION'},{priceExceptionLineId:{not:null}}]}];
  for(const filter of config.filters){if(filter.field==='priceExceptionId')where.push({priceExceptionLine:{priceExceptionId:filter.value as number}});else if(filter.field==='peSalespersonId')where.push({priceExceptionLine:{priceException:{assignedSalesRepUserId:filter.value as number}}});}
  const [allPeRows,allProductLines]=await Promise.all([client.opportunityProduct.findMany({where:{AND:where},include:peUsageInclude}),client.opportunityProduct.findMany({where:{AND:common},select:{quantity:true,estimatedUnitPrice:true,opportunity:{select:{currencyCode:true}},sku:{select:{priceUnit:true}}}})]);
  const denominators=new Map<string,Prisma.Decimal>();for(const row of allProductLines){const key=`${row.opportunity.currencyCode}|${row.sku?.priceUnit??'EACH'}`;denominators.set(key,(denominators.get(key)??new Prisma.Decimal(0)).add(lineTotal(row)));}
  const rows=allPeRows.filter(row=>config.filters.every(filter=>{if(filter.field==='moqStatus'){const moq=peMoq(row),status=moq===null?'UNKNOWN':new Prisma.Decimal(row.quantity).gte(moq)?'MET':'NOT_MET';return status===filter.value;}if(filter.field==='overrideStatus')return filter.value==='APPLIED'?peOverride(row)===true:peOverride(row)===false;return true;}));
  const read=(row:PeUsageDbRow,field:string):string|number=>field==='lineValue'?lineTotal(row).toNumber():field==='quantity'?row.quantity:field==='product'?row.product.name:field==='opportunity'?row.opportunity.name:field==='peCode'?row.priceExceptionCode??'':field==='owner'?row.opportunity.owner?.lastName??'':field==='closeDate'?row.opportunity.expectedCloseDate?.getTime()??0:0;
  rows.sort((a,b)=>{for(const spec of config.sort){const x=read(a,spec.field),y=read(b,spec.field),cmp=x<y?-1:x>y?1:0;if(cmp)return spec.direction==='asc'?cmp:-cmp;}return a.id-b.id;});
  const groups=new Map<string,{key:string;label:string;rows:PeUsageDbRow[]}>();for(const row of rows)for(const group of peGroupValues(row,config.groupBy)){const found=groups.get(group.key)??{...group,rows:[]};found.rows.push(row);groups.set(group.key,found);}
  return {reportType:'PRICE_EXCEPTION_USAGE',overall:{opportunityCount:new Set(rows.map(row=>row.opportunityId)).size,productLineCount:rows.length,priceExceptionCount:new Set(rows.map(peKey).filter(Boolean)).size},summary:peMetrics(rows,denominators,true),groups:[...groups.values()].sort((a,b)=>a.label.localeCompare(b.label)).map(group=>({key:group.key,label:group.label,metrics:peMetrics(group.rows,denominators),lineIds:group.rows.map(row=>row.id)})),rows:rows.map(row=>{const approved=row.priceExceptionUnitPrice===null?null:new Prisma.Decimal(row.priceExceptionUnitPrice),actual=new Prisma.Decimal(row.estimatedUnitPrice),moq=peMoq(row),pe=row.priceExceptionLine?.priceException;return {id:row.id,opportunityId:row.opportunityId,opportunity:row.opportunity.name,accounts:row.opportunity.participants.map(x=>({id:x.accountId,name:x.account.name})).sort((a,b)=>a.name.localeCompare(b.name)),owner:row.opportunity.owner?`${row.opportunity.owner.firstName} ${row.opportunity.owner.lastName}`:'Unassigned',productId:row.productId,product:row.product.name,sku:row.sku?.partNumber??row.product.sku,productCategory:row.product.category?.name??'No Product Category',quantity:row.quantity,peCode:row.priceExceptionCode??'Unnumbered',priceExceptionId:row.priceExceptionLine?.priceExceptionId??null,peDetailAvailable:!!pe&&canViewPriceException(actor,pe),peSalesperson:pe?.assignedSalesRepUser?`${pe.assignedSalesRepUser.firstName} ${pe.assignedSalesRepUser.lastName}`:'Unassigned',peMoq:moq?.toString()??null,approvedUnitPrice:approved?.toFixed(2)??null,unitPrice:actual.toFixed(2),overrideAmount:approved?actual.sub(approved).toFixed(2):null,overridePercent:approved&&!approved.isZero()?actual.sub(approved).div(approved).mul(100).toFixed(2):null,lineValue:lineTotal(row).toFixed(2),moqStatus:moq===null?'Unknown':new Prisma.Decimal(row.quantity).gte(moq)?'MOQ Met':'MOQ Not Met',overrideApplied:peOverride(row),stage:row.opportunity.stage.name,forecastCategory:row.opportunity.forecastCategory,closeDate:row.opportunity.expectedCloseDate?.toISOString().slice(0,10)??null,currency:row.opportunity.currencyCode,unit:row.sku?.priceUnit??'EACH',groupKeys:peGroupValues(row,config.groupBy).map(x=>x.key)};}),currencies:[...new Set(rows.map(row=>row.opportunity.currencyCode))].sort(),semanticNote:priceExceptionUsageDefinition.semanticNote};
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
  if (reportType === 'PRICE_EXCEPTION_USAGE') return executePriceExceptionUsageReport(client,actor,rawConfig,now);
  if (reportType === 'CHANNEL_PARTNER') return executeChannelPartnerReport(client,actor,rawConfig,now);
  if (reportType === 'PROJECT_INITIATIVE') return executeProjectInitiativeReport(client,actor,rawConfig,now);
  if (reportType !== 'PIPELINE') { validateReportConfiguration(reportType,rawConfig); throw new Error('Report execution is not implemented.'); }
  return executePipelineReport(client,actor,rawConfig,now);
}
