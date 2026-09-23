import { defaultReportConfiguration, validateReportConfiguration, type ReportConfiguration } from './reporting';

type Params = Record<string,string|string[]|undefined>;
const one=(value:string|string[]|undefined)=>Array.isArray(value)?value[0]:value;
const many=(value:string|string[]|undefined)=>value===undefined?[]:Array.isArray(value)?value:[value];
const number=(value:string|undefined)=>value&&Number.isSafeInteger(Number(value))&&Number(value)>0?Number(value):null;
export function pipelineConfigFromParams(params: Params, fallback?: unknown): ReportConfiguration {
  if(one(params.configured)!=='1') return validateReportConfiguration('PIPELINE',fallback??defaultReportConfiguration('PIPELINE'));
  const filters:ReportConfiguration['filters']=[];
  for(const field of ['ownerId','stageId','competitorId','accountId','productCategoryId','projectId'] as const){const value=number(one(params[field]));if(value)filters.push({field,operator:'eq',value});}
  for(const field of ['industry','territory','currency'] as const){const value=one(params[field]);if(value)filters.push({field,operator:'eq',value});}
  const status=one(params.status);if(status)filters.push({field:'status',operator:'eq',value:status});
  if (one(params.activeSalesRep) === '1') filters.push({field:'activeSalesRep',operator:'eq',value:true});
  const forecastCategory=one(params.forecastCategory);if(forecastCategory)filters.push({field:'forecastCategory',operator:'eq',value:forecastCategory});
  const preset=one(params.closeDatePreset);if(preset&&preset!=='CUSTOM'&&preset!=='ANY')filters.push({field:'closeDate',operator:'preset',value:preset});
  else if(preset!=='ANY'){const from=one(params.closeFrom),to=one(params.closeTo);if(from&&to)filters.push({field:'closeDate',operator:'between',value:{from,to}});}
  const metrics=many(params.metrics),columns=many(params.columns);
  return validateReportConfiguration('PIPELINE',{filters,groupBy:one(params.groupBy)||null,sort:[{field:one(params.sortField)||'closeDate',direction:one(params.sortDirection)||'asc'}],metrics:metrics.length?metrics:['pipeline','opportunityCount'],columns:columns.length?columns:['opportunity','account','owner','stage','closeDate','value','weightedValue','currency']});
}
export function filterValue(config:ReportConfiguration,field:string){return config.filters.find(filter=>filter.field===field)?.value;}
export function accountActivityConfigFromParams(params:Params, fallback?:unknown):ReportConfiguration {
  if(one(params.configured)!=='1')return validateReportConfiguration('ACCOUNT_ACTIVITY',fallback??defaultReportConfiguration('ACCOUNT_ACTIVITY'));
  const filters:ReportConfiguration['filters']=[];
  for(const field of ['ownerId','accountId','minDays'] as const){const value=number(one(params[field]));if(value)filters.push({field,operator:field==='minDays'?'gte':'eq',value});}
  for(const field of ['industry','territory','businessRole','activityType'] as const){const value=one(params[field]);if(value)filters.push({field,operator:'eq',value});}
  if(['true','false'].includes(one(params.strategicAccount)??''))filters.push({field:'strategicAccount',operator:'eq',value:one(params.strategicAccount)==='true'});
  if(['true','false'].includes(one(params.hasActivity)??''))filters.push({field:'hasActivity',operator:'eq',value:one(params.hasActivity)==='true'});
  const defaults=defaultReportConfiguration('ACCOUNT_ACTIVITY'),metrics=many(params.metrics),columns=many(params.columns);
  return validateReportConfiguration('ACCOUNT_ACTIVITY',{filters,groupBy:one(params.groupBy)||null,sort:[{field:one(params.sortField)||'lastActivity',direction:one(params.sortDirection)||'asc'}],metrics:metrics.length?metrics:defaults.metrics,columns:columns.length?columns:defaults.columns});
}
export function productPerformanceConfigFromParams(params:Params,fallback?:unknown):ReportConfiguration {
  if(one(params.configured)!=='1')return validateReportConfiguration('PRODUCT_PERFORMANCE',fallback??defaultReportConfiguration('PRODUCT_PERFORMANCE'));
  const filters:ReportConfiguration['filters']=[];
  for(const field of ['ownerId','stageId','accountId','productCategoryId','productId','skuId','odmCustomerAccountId','projectId'] as const){const value=number(one(params[field]));if(value)filters.push({field,operator:'eq',value});}
  for(const field of ['industry','territory','currency','status','forecastCategory','priceSource','catalogSource'] as const){const value=one(params[field]);if(value)filters.push({field,operator:'eq',value});}
  if(['true','false'].includes(one(params.strategicAccount)??''))filters.push({field:'strategicAccount',operator:'eq',value:one(params.strategicAccount)==='true'});
  const preset=one(params.closeDatePreset);if(preset&&preset!=='CUSTOM'&&preset!=='ANY')filters.push({field:'closeDate',operator:'preset',value:preset});
  else if(preset!=='ANY'){const from=one(params.closeFrom),to=one(params.closeTo);if(from&&to)filters.push({field:'closeDate',operator:'between',value:{from,to}});}
  const defaults=defaultReportConfiguration('PRODUCT_PERFORMANCE'),metrics=many(params.metrics),columns=many(params.columns);
  return validateReportConfiguration('PRODUCT_PERFORMANCE',{filters,groupBy:one(params.groupBy)||null,sort:[{field:one(params.sortField)||'lineValue',direction:one(params.sortDirection)||'desc'}],metrics:metrics.length?metrics:defaults.metrics,columns:columns.length?columns:defaults.columns});
}
export function priceExceptionUsageConfigFromParams(params:Params,fallback?:unknown):ReportConfiguration {
  if(one(params.configured)!=='1')return validateReportConfiguration('PRICE_EXCEPTION_USAGE',fallback??defaultReportConfiguration('PRICE_EXCEPTION_USAGE'));
  const filters:ReportConfiguration['filters']=[];
  for(const field of ['ownerId','accountId','opportunityId','stageId','competitorId','productId','skuId','productCategoryId','priceExceptionId','peSalespersonId'] as const){const value=number(one(params[field]));if(value)filters.push({field,operator:'eq',value});}
  for(const field of ['forecastCategory','status','currency','moqStatus','overrideStatus'] as const){const value=one(params[field]);if(value)filters.push({field,operator:'eq',value});}
  const preset=one(params.closeDatePreset);if(preset&&preset!=='CUSTOM'&&preset!=='ANY')filters.push({field:'closeDate',operator:'preset',value:preset});
  else if(preset!=='ANY'){const from=one(params.closeFrom),to=one(params.closeTo);if(from&&to)filters.push({field:'closeDate',operator:'between',value:{from,to}});}
  const defaults=defaultReportConfiguration('PRICE_EXCEPTION_USAGE'),metrics=many(params.metrics),columns=many(params.columns);
  return validateReportConfiguration('PRICE_EXCEPTION_USAGE',{filters,groupBy:one(params.groupBy)||null,sort:[{field:one(params.sortField)||'lineValue',direction:one(params.sortDirection)||'desc'}],metrics:metrics.length?metrics:defaults.metrics,columns:columns.length?columns:defaults.columns});
}
export function channelPartnerConfigFromParams(params:Params,fallback?:unknown):ReportConfiguration {
  if(one(params.configured)!=='1')return validateReportConfiguration('CHANNEL_PARTNER',fallback??defaultReportConfiguration('CHANNEL_PARTNER'));
  const filters:ReportConfiguration['filters']=[];
  for(const field of ['ownerId','accountId','stageId','productCategoryId','projectId'] as const){const value=number(one(params[field]));if(value)filters.push({field,operator:'eq',value});}
  for(const field of ['participantRole','status','forecastCategory','industry','territory','currency'] as const){const value=one(params[field]);if(value)filters.push({field,operator:'eq',value});}
  if(['true','false'].includes(one(params.strategicAccount)??''))filters.push({field:'strategicAccount',operator:'eq',value:one(params.strategicAccount)==='true'});
  const preset=one(params.closeDatePreset);if(preset&&preset!=='CUSTOM'&&preset!=='ANY')filters.push({field:'closeDate',operator:'preset',value:preset});
  else if(preset!=='ANY'){const from=one(params.closeFrom),to=one(params.closeTo);if(from&&to)filters.push({field:'closeDate',operator:'between',value:{from,to}});}
  const defaults=defaultReportConfiguration('CHANNEL_PARTNER'),metrics=many(params.metrics),columns=many(params.columns);
  return validateReportConfiguration('CHANNEL_PARTNER',{filters,groupBy:one(params.groupBy)||null,sort:[{field:one(params.sortField)||'value',direction:one(params.sortDirection)||'desc'}],metrics:metrics.length?metrics:defaults.metrics,columns:columns.length?columns:defaults.columns});
}
export function projectInitiativeConfigFromParams(params:Params,fallback?:unknown):ReportConfiguration {
  if(one(params.configured)!=='1')return validateReportConfiguration('PROJECT_INITIATIVE',fallback??defaultReportConfiguration('PROJECT_INITIATIVE'));
  const filters:ReportConfiguration['filters']=[];
  for(const field of ['projectOwnerId','projectId','primaryAccountId','participantAccountId','ownerId','stageId','competitorId','productCategoryId'] as const){const value=number(one(params[field]));if(value)filters.push({field,operator:'eq',value});}
  for(const field of ['projectStatus','forecastCategory','status','currency'] as const){const value=one(params[field]);if(value)filters.push({field,operator:'eq',value});}
  for(const field of ['hasAccount','hasOpportunities'] as const){const value=one(params[field]);if(value==='true'||value==='false')filters.push({field,operator:'eq',value:value==='true'});}
  for(const field of ['startDate','targetEndDate','closeDate'] as const){const choice=one(params[`${field}Preset`]);if(field==='targetEndDate'&&['OVERDUE','NEXT_30_DAYS','NO_DATE'].includes(choice??''))filters.push({field,operator:'attention',value:choice});else if(choice&&choice!=='CUSTOM'&&choice!=='ANY')filters.push({field,operator:'preset',value:choice});else if(choice==='CUSTOM'){const from=one(params[`${field}From`]),to=one(params[`${field}To`]);if(from&&to)filters.push({field,operator:'between',value:{from,to}});}}
  const defaults=defaultReportConfiguration('PROJECT_INITIATIVE'),metrics=many(params.metrics),columns=many(params.columns);
  return validateReportConfiguration('PROJECT_INITIATIVE',{filters,groupBy:one(params.groupBy)||null,sort:[{field:one(params.sortField)||'pipeline',direction:one(params.sortDirection)||'desc'}],metrics:metrics.length?metrics:defaults.metrics,columns:columns.length?columns:defaults.columns});
}
export function tradeShowConfigFromParams(params:Params,fallback?:unknown):ReportConfiguration {
  if(one(params.configured)!=='1')return validateReportConfiguration('TRADE_SHOW',fallback??defaultReportConfiguration('TRADE_SHOW'));
  const filters:ReportConfiguration['filters']=[];
  for(const field of ['tradeShowId','ownerId','competitorId','stageId','referralPartnerId'] as const){const value=number(one(params[field]));if(value)filters.push({field,operator:'eq',value});}
  for(const field of ['leadStatus','routing','followUpStatus','forecastCategory','currency'] as const){const value=one(params[field]);if(value)filters.push({field,operator:'eq',value});}
  for(const field of ['converted','accountLinked','contactLinked'] as const){const value=one(params[field]);if(value==='true'||value==='false')filters.push({field,operator:'eq',value:value==='true'});}
  for(const field of ['productInterest','search'] as const){const value=one(params[field])?.trim();if(value)filters.push({field,operator:'contains',value});}
  const preset=one(params.showDatePreset);if(preset&&preset!=='CUSTOM'&&preset!=='ANY')filters.push({field:'showDate',operator:'preset',value:preset});
  else if(preset==='CUSTOM'){const from=one(params.showDateFrom),to=one(params.showDateTo);if(from&&to)filters.push({field:'showDate',operator:'between',value:{from,to}});}
  const defaults=defaultReportConfiguration('TRADE_SHOW'),metrics=many(params.metrics),columns=many(params.columns);
  return validateReportConfiguration('TRADE_SHOW',{filters,groupBy:one(params.groupBy)||null,sort:[{field:one(params.sortField)||'capturedDate',direction:one(params.sortDirection)||'desc'}],metrics:metrics.length?metrics:defaults.metrics,columns:columns.length?columns:defaults.columns});
}
