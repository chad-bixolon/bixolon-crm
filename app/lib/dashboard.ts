import { operationalActivityWhere } from './operational-where';
import type { Prisma, PrismaClient, UserRole } from '@prisma/client';
import { can, taskScope, type Actor } from './authorization';
import { canRunReportType, canViewBuiltInReport, canViewReportDefinition, validateReportConfiguration } from './reporting';
import { engagementAccountWhere } from './engagement';
import { dashboardOpenTaskWhere } from './work';
import { canViewSalesLeadQueue } from './trade-show-leads';

export type DashboardSection = 'forecast' | 'reps' | 'closing' | 'stage' | 'category' | 'stale' | 'tasks' | 'activities' | 'tradeShowLeads' | 'admin' | 'marketing';
export type DashboardView = { title: string; sections: readonly DashboardSection[] };

export const dashboardWidgetKeys = ['FORECAST_SUMMARY','PIPELINE_BY_REP','PIPELINE_BY_STAGE','PIPELINE_BY_PRODUCT_CATEGORY','CLOSING_OPPORTUNITIES','STALE_ACCOUNTS','OVERDUE_TASKS','RECENT_ACTIVITY','MY_TRADE_SHOW_LEADS','MARKETING_SUMMARY','ADMIN_SHORTCUTS'] as const;
export type DashboardWidgetKey = typeof dashboardWidgetKeys[number];
export type DashboardWidgetSize = 'HALF'|'FULL';
export type SavedReportWidgetStyle = 'KPI'|'COMPACT_TABLE'|'GROUPED_SUMMARY';
export const dashboardPresentationSectionKeys = ['FORECAST','PIPELINE','ATTENTION','MARKETING','ADMINISTRATION','PINNED_REPORTS'] as const;
export type DashboardPresentationSection = typeof dashboardPresentationSectionKeys[number];
export const dashboardPresentationSectionTitles: Record<DashboardPresentationSection,string> = {
  FORECAST:'Forecast Summary',
  PIPELINE:'Pipeline & Forecast',
  ATTENTION:'Attention & Activity',
  MARKETING:'Marketing',
  ADMINISTRATION:'Administration',
  PINNED_REPORTS:'Pinned Reports',
};
export type DashboardBuiltinItem = { kind:'BUILTIN'; key:DashboardWidgetKey; size:DashboardWidgetSize };
export type DashboardReportItem = { kind:'SAVED_REPORT'; reportId:number; size:DashboardWidgetSize; style:SavedReportWidgetStyle; title?:string };
export type DashboardLayoutItem = DashboardBuiltinItem|DashboardReportItem;
export type DashboardLayoutConfiguration = { version:1; items:DashboardLayoutItem[] };

type WidgetDefinition = { title:string; description:string; sizes:readonly DashboardWidgetSize[]; defaultSize:DashboardWidgetSize; hideable:boolean; section:DashboardSection; presentationSection:Exclude<DashboardPresentationSection,'PINNED_REPORTS'>; roles:readonly UserRole[]; drillDown?:string };
export const dashboardWidgetRegistry: Record<DashboardWidgetKey,WidgetDefinition> = {
  FORECAST_SUMMARY:{title:'Forecast Summary',description:'Pipeline, commit, targets, and coverage for the current quarter.',sizes:['FULL'],defaultSize:'FULL',hideable:true,section:'forecast',presentationSection:'FORECAST',roles:['ADMIN','SALES_MANAGER','SALES','READ_ONLY'],drillDown:'/reports/forecast'},
  PIPELINE_BY_REP:{title:'Sales Rep Forecast',description:'Team pipeline and forecast grouped by Sales Rep.',sizes:['HALF','FULL'],defaultSize:'HALF',hideable:true,section:'reps',presentationSection:'PIPELINE',roles:['ADMIN','SALES_MANAGER','READ_ONLY']},
  PIPELINE_BY_STAGE:{title:'Pipeline by Stage',description:'Current-quarter pipeline grouped by stage.',sizes:['HALF','FULL'],defaultSize:'HALF',hideable:true,section:'stage',presentationSection:'PIPELINE',roles:['ADMIN','SALES_MANAGER','SALES','READ_ONLY']},
  PIPELINE_BY_PRODUCT_CATEGORY:{title:'Pipeline by Product Category',description:'Current-quarter pipeline grouped by Product Category.',sizes:['HALF','FULL'],defaultSize:'HALF',hideable:true,section:'category',presentationSection:'PIPELINE',roles:['ADMIN','SALES_MANAGER','READ_ONLY']},
  CLOSING_OPPORTUNITIES:{title:'Opportunities Closing This Quarter',description:'Open Opportunities expected to close this quarter.',sizes:['FULL'],defaultSize:'FULL',hideable:true,section:'closing',presentationSection:'PIPELINE',roles:['ADMIN','SALES_MANAGER','SALES','READ_ONLY']},
  STALE_ACCOUNTS:{title:'Accounts with No Activity 90+ Days',description:'Active Accounts needing engagement.',sizes:['HALF','FULL'],defaultSize:'HALF',hideable:true,section:'stale',presentationSection:'ATTENTION',roles:['ADMIN','SALES_MANAGER','SALES']},
  OVERDUE_TASKS:{title:'Overdue Tasks',description:'Open Tasks past their due date.',sizes:['HALF','FULL'],defaultSize:'HALF',hideable:true,section:'tasks',presentationSection:'ATTENTION',roles:['ADMIN','SALES_MANAGER','SALES','MARKETING_MANAGER']},
  RECENT_ACTIVITY:{title:'Recent Activity',description:'Latest CRM activity in your permitted scope.',sizes:['HALF','FULL'],defaultSize:'HALF',hideable:true,section:'activities',presentationSection:'ATTENTION',roles:['ADMIN','SALES_MANAGER','SALES']},
  MY_TRADE_SHOW_LEADS:{title:'My Trade Show Leads',description:'Actionable internal Sales leads assigned to you.',sizes:['HALF','FULL'],defaultSize:'HALF',hideable:true,section:'tradeShowLeads',presentationSection:'ATTENTION',roles:['ADMIN','SALES_MANAGER','SALES'],drillDown:'/trade-shows/my-leads'},
  MARKETING_SUMMARY:{title:'Marketing Summary',description:'Marketing-safe Account and Trade Show lead overview.',sizes:['FULL'],defaultSize:'FULL',hideable:true,section:'marketing',presentationSection:'MARKETING',roles:['MARKETING_MANAGER']},
  ADMIN_SHORTCUTS:{title:'Administration Shortcuts',description:'Quick access to common Administration areas.',sizes:['FULL'],defaultSize:'FULL',hideable:true,section:'admin',presentationSection:'ADMINISTRATION',roles:['ADMIN']},
};

export function dashboardItemPresentationSection(item:DashboardLayoutItem):DashboardPresentationSection {
  return item.kind==='SAVED_REPORT'?'PINNED_REPORTS':dashboardWidgetRegistry[item.key].presentationSection;
}

// A role chooses the default presentation. Authorization still decides which
// data and actions are accessible; future role-view settings must not grant access.
const views: Record<UserRole, DashboardView> = {
  SALES: { title: 'My sales dashboard', sections: ['forecast','closing','stale','tasks','activities','tradeShowLeads','stage'] },
  SALES_MANAGER: { title: 'Team sales dashboard', sections: ['forecast','reps','closing','stale','tasks','activities','tradeShowLeads','stage','category'] },
  ADMIN: { title: 'Sales dashboard', sections: ['forecast','reps','closing','stale','tasks','activities','tradeShowLeads','stage','category','admin'] },
  READ_ONLY: { title: 'Sales overview', sections: ['forecast','reps','closing','stage','category'] },
  MARKETING_MANAGER: { title: 'Marketing overview', sections: ['marketing'] },
};

const item=(key:DashboardWidgetKey,size?:DashboardWidgetSize):DashboardBuiltinItem=>({kind:'BUILTIN',key,size:size??dashboardWidgetRegistry[key].defaultSize});
export const systemDashboardDefaults: Record<UserRole,DashboardLayoutConfiguration> = {
  SALES:{version:1,items:[item('FORECAST_SUMMARY'),item('PIPELINE_BY_STAGE'),item('CLOSING_OPPORTUNITIES'),item('STALE_ACCOUNTS'),item('OVERDUE_TASKS'),item('RECENT_ACTIVITY'),item('MY_TRADE_SHOW_LEADS')]},
  SALES_MANAGER:{version:1,items:[item('FORECAST_SUMMARY'),item('PIPELINE_BY_REP'),item('PIPELINE_BY_STAGE'),item('PIPELINE_BY_PRODUCT_CATEGORY'),item('CLOSING_OPPORTUNITIES'),item('STALE_ACCOUNTS'),item('OVERDUE_TASKS'),item('RECENT_ACTIVITY')]},
  ADMIN:{version:1,items:[item('FORECAST_SUMMARY'),item('PIPELINE_BY_REP'),item('PIPELINE_BY_STAGE'),item('PIPELINE_BY_PRODUCT_CATEGORY'),item('CLOSING_OPPORTUNITIES'),item('STALE_ACCOUNTS'),item('OVERDUE_TASKS'),item('RECENT_ACTIVITY'),item('ADMIN_SHORTCUTS')]},
  READ_ONLY:{version:1,items:[item('FORECAST_SUMMARY'),item('PIPELINE_BY_REP'),item('PIPELINE_BY_STAGE'),item('PIPELINE_BY_PRODUCT_CATEGORY'),item('CLOSING_OPPORTUNITIES')]},
  MARKETING_MANAGER:{version:1,items:[item('MARKETING_SUMMARY'),item('OVERDUE_TASKS')]},
};

export function canUseDashboardWidget(actor:Actor,key:DashboardWidgetKey) {
  const definition=dashboardWidgetRegistry[key];
  return definition.roles.includes(actor.role)&&canShowDashboardSection(actor,definition.section);
}

function object(value:unknown):value is Record<string,unknown>{return !!value&&typeof value==='object'&&!Array.isArray(value);}
function title(value:unknown){if(value===undefined||value===null||value==='')return undefined;if(typeof value!=='string')throw new Error('Widget title is invalid.');const clean=value.replace(/[\u0000-\u001f\u007f]/g,'').trim();if(!clean||clean.length>120)throw new Error('Widget title must be 120 characters or fewer.');return clean;}
export async function validateDashboardLayout(client:PrismaClient,actor:Actor,input:unknown,options:{roleDefault?:boolean}={}) : Promise<DashboardLayoutConfiguration> {
  if(!object(input)||input.version!==1||!Array.isArray(input.items)||Object.keys(input).some(key=>!['version','items'].includes(key)))throw new Error('Dashboard layout is invalid.');
  if(input.items.length>24)throw new Error('A Dashboard can contain at most 24 widgets.');
  const builtins=new Set<string>(),reports=new Set<number>(),reportIds:number[]=[];
  const items=input.items.map((raw):DashboardLayoutItem=>{
    if(!object(raw)||typeof raw.kind!=='string')throw new Error('Dashboard widget is invalid.');
    if(raw.kind==='BUILTIN'){
      if(Object.keys(raw).some(key=>!['kind','key','size'].includes(key))||!dashboardWidgetKeys.includes(raw.key as DashboardWidgetKey))throw new Error('Unknown Dashboard widget.');
      const key=raw.key as DashboardWidgetKey,definition=dashboardWidgetRegistry[key];
      if(!canUseDashboardWidget(actor,key))throw new Error('This Dashboard widget is not available to this role.');
      if(!definition.sizes.includes(raw.size as DashboardWidgetSize))throw new Error('Unsupported widget size.');
      if(builtins.has(key))throw new Error('A built-in widget can only appear once.');builtins.add(key);
      return {kind:'BUILTIN',key,size:raw.size as DashboardWidgetSize};
    }
    if(raw.kind!=='SAVED_REPORT'||options.roleDefault)throw new Error('Role defaults may contain only built-in widgets.');
    if(Object.keys(raw).some(key=>!['kind','reportId','size','style','title'].includes(key))||!Number.isSafeInteger(raw.reportId)||Number(raw.reportId)<1)throw new Error('Saved Report widget is invalid.');
    if(!['HALF','FULL'].includes(String(raw.size))||!['KPI','COMPACT_TABLE','GROUPED_SUMMARY'].includes(String(raw.style)))throw new Error('Unsupported Saved Report display option.');
    const reportId=Number(raw.reportId);if(reports.has(reportId))throw new Error('A Saved Report can only be added once.');reports.add(reportId);reportIds.push(reportId);
    return {kind:'SAVED_REPORT',reportId,size:raw.size as DashboardWidgetSize,style:raw.style as SavedReportWidgetStyle,title:title(raw.title)};
  });
  if(reportIds.length>8)throw new Error('A Dashboard can contain at most 8 Saved Reports.');
  if(reportIds.length){
    const found=await client.reportDefinition.findMany({where:{id:{in:reportIds}}});
    for(const reportId of reportIds){const report=found.find(value=>value.id===reportId);if(!report||!canViewReportDefinition(actor,report))throw new Error('A selected Saved Report is unavailable.');const config=validateReportConfiguration(report.reportType,report.configuration);const selected=items.find(value=>value.kind==='SAVED_REPORT'&&value.reportId===reportId) as DashboardReportItem;if(selected.style==='GROUPED_SUMMARY'&&!config.groupBy)throw new Error('Grouped Summary requires a grouped Saved Report.');}
  }
  return {version:1,items};
}

export async function safeDashboardLayout(client:PrismaClient,actor:Actor,input:unknown,options:{roleDefault?:boolean}={}) {
  try{return await validateDashboardLayout(client,actor,input,options);}catch{return null;}
}

async function recoverAvailableDashboardItems(client:PrismaClient,actor:Actor,input:unknown){
  if(!object(input)||input.version!==1||!Array.isArray(input.items))return null;
  const items:DashboardLayoutItem[]=[];
  for(const raw of input.items.slice(0,24)){
    try{const one=await validateDashboardLayout(client,actor,{version:1,items:[raw]});const candidate=one.items[0];if(candidate.kind==='BUILTIN'&&items.some(item=>item.kind==='BUILTIN'&&item.key===candidate.key))continue;if(candidate.kind==='SAVED_REPORT'&&items.some(item=>item.kind==='SAVED_REPORT'&&item.reportId===candidate.reportId))continue;items.push(candidate);}catch{/* Stale, deleted, or newly unauthorized widgets are intentionally omitted. */}
  }
  return {version:1 as const,items};
}

export async function getRoleDashboardLayout(client:PrismaClient,actor:Actor){
  const stored=await client.roleDashboardLayout.findUnique({where:{role:actor.role}});
  return await safeDashboardLayout(client,actor,stored?.configuration,{roleDefault:true})??systemDashboardDefaults[actor.role];
}

export async function getEffectiveDashboardLayout(client:PrismaClient,actor:Actor){
  const personal=await client.userDashboardLayout.findUnique({where:{userId:actor.id}});
  if(personal?.role===actor.role){const valid=await safeDashboardLayout(client,actor,personal.configuration)??await recoverAvailableDashboardItems(client,actor,personal.configuration);if(valid)return {configuration:valid,personalized:true};}
  return {configuration:await getRoleDashboardLayout(client,actor),personalized:false};
}

export function availableDashboardWidgets(actor:Actor){return dashboardWidgetKeys.filter(key=>canUseDashboardWidget(actor,key)).map(key=>({key,...dashboardWidgetRegistry[key]}));}

export function canShowDashboardSection(actor: Actor, section: DashboardSection) {
  if (!views[actor.role].sections.includes(section)) return false;
  if (['forecast','reps','closing','stage','category'].includes(section)) return canRunReportType(actor, 'PIPELINE');
  if (section === 'stale') return canViewBuiltInReport(actor, 'ACCOUNT_ENGAGEMENT');
  if (section === 'tasks' || section === 'activities') return can(actor, 'tasks.read');
  if (section === 'tradeShowLeads') return canViewSalesLeadQueue(actor);
  if (section === 'admin') return can(actor, 'users.manage');
  return can(actor, 'marketing.read') && can(actor, 'accounts.read');
}

export function getDashboardViewForRole(actor: Actor): DashboardView {
  return { ...views[actor.role], sections: views[actor.role].sections.filter(section => canShowDashboardSection(actor, section)) };
}

export function dashboardPeriod(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: 'numeric' }).formatToParts(now);
  const read = (type: string) => Number(parts.find(part => part.type === type)?.value);
  return { year: read('year'), quarter: `Q${Math.floor((read('month') - 1) / 3) + 1}` as 'Q1'|'Q2'|'Q3'|'Q4' };
}

export function dashboardAccountWhere(actor: Actor): Prisma.AccountWhereInput {
  if (!canViewBuiltInReport(actor, 'ACCOUNT_ENGAGEMENT')) throw new Error('Access denied');
  return engagementAccountWhere(actor);
}

export function dashboardTaskWhere(actor: Actor, today: Date, repIds: number[]): Prisma.TaskWhereInput {
  if (!can(actor, 'tasks.read')) throw new Error('Access denied');
  return { ...dashboardOpenTaskWhere(), dueDate: { lt: today }, ...taskScope(actor), ...(actor.role === 'SALES' ? {} : { assignedToId: { in: repIds } }) };
}

export function dashboardActivityWhere(actor: Actor, repIds: number[]): Prisma.ActivityWhereInput {
  if (!can(actor, 'tasks.read')) throw new Error('Access denied');
  return { AND: [operationalActivityWhere], userId: actor.role === 'SALES' ? actor.id : { in: repIds } };
}

export function pipelineReportHref(input: { currency: string; ownerId?: number; groupBy?: 'owner'|'stage'|'productCategory'; commit?: boolean; team?: boolean }) {
  const p = new URLSearchParams({ configured: '1', status: 'OPEN', closeDatePreset: 'THIS_QUARTER', currency: input.currency, forecastCategory: input.commit ? 'COMMIT' : 'IN_FORECAST' });
  if (input.team) p.set('activeSalesRep', '1');
  if (input.ownerId) p.set('ownerId', String(input.ownerId));
  if (input.groupBy) p.set('groupBy', input.groupBy);
  return `/reports/new?${p}`;
}
