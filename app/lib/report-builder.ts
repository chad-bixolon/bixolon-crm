import { defaultReportConfiguration, validateReportConfiguration, type ReportConfiguration } from './reporting';

type Params = Record<string,string|string[]|undefined>;
const one=(value:string|string[]|undefined)=>Array.isArray(value)?value[0]:value;
const many=(value:string|string[]|undefined)=>value===undefined?[]:Array.isArray(value)?value:[value];
const number=(value:string|undefined)=>value&&Number.isSafeInteger(Number(value))&&Number(value)>0?Number(value):null;
export function pipelineConfigFromParams(params: Params, fallback?: unknown): ReportConfiguration {
  if(one(params.configured)!=='1') return validateReportConfiguration('PIPELINE',fallback??defaultReportConfiguration('PIPELINE'));
  const filters:ReportConfiguration['filters']=[];
  for(const field of ['ownerId','stageId','accountId','productCategoryId','projectId'] as const){const value=number(one(params[field]));if(value)filters.push({field,operator:'eq',value});}
  for(const field of ['industry','territory','currency'] as const){const value=one(params[field]);if(value)filters.push({field,operator:'eq',value});}
  const status=one(params.status);if(status)filters.push({field:'status',operator:'eq',value:status});
  const preset=one(params.closeDatePreset);if(preset&&preset!=='CUSTOM'&&preset!=='ANY')filters.push({field:'closeDate',operator:'preset',value:preset});
  else if(preset!=='ANY'){const from=one(params.closeFrom),to=one(params.closeTo);if(from&&to)filters.push({field:'closeDate',operator:'between',value:{from,to}});}
  const metrics=many(params.metrics),columns=many(params.columns);
  return validateReportConfiguration('PIPELINE',{filters,groupBy:one(params.groupBy)||null,sort:[{field:one(params.sortField)||'closeDate',direction:one(params.sortDirection)||'asc'}],metrics:metrics.length?metrics:['pipeline','opportunityCount'],columns:columns.length?columns:['opportunity','account','owner','stage','closeDate','value','weightedValue','currency']});
}
export function filterValue(config:ReportConfiguration,field:string){return config.filters.find(filter=>filter.field===field)?.value;}
