import type { DeploymentModule } from "@prisma/client";

export const moduleDefinitions = {
  OPPORTUNITIES: { name: 'Opportunities', description: 'Deals, pipeline, and related sales work.', requires: [] },
  PROJECTS: { name: 'Projects', description: 'Customer initiatives and project work.', requires: [] },
  SUPPORT_CASES: { name: 'Support Cases', description: 'Customer issues and support follow-up.', requires: [] },
  SUPPORT_INBOX: { name: 'Support Inbox', description: 'Turn support mailbox messages into cases.', requires: ['SUPPORT_CASES'] },
  MARKETING: { name: 'Marketing', description: 'Campaigns, audiences, lead sources, and attribution.', requires: [] },
  TRADE_SHOWS: { name: 'Trade Shows', description: 'Events, leads, routing, and follow-up.', requires: [] },
  DEMOS: { name: 'Demos', description: 'Demo equipment requests and deployment.', requires: [] },
  PRICE_EXCEPTIONS: { name: 'Price Exceptions', description: 'Approved customer pricing and follow-up.', requires: ['PRODUCTS'] },
  PRODUCTS: { name: 'Products', description: 'Product and SKU catalog.', requires: [] },
  SALES_PLANS: { name: 'Sales Plans', description: 'Annual sales plans and targets.', requires: ['OPPORTUNITIES'] },
  FORECASTING: { name: 'Forecasting', description: 'Forecasts, snapshots, and pipeline movement.', requires: ['OPPORTUNITIES'] },
} as const satisfies Record<DeploymentModule, { name: string; description: string; requires: readonly DeploymentModule[] }>;

export const modules = Object.keys(moduleDefinitions) as DeploymentModule[];
export type ModuleAvailability = { configured: ReadonlySet<DeploymentModule>; effective: ReadonlySet<DeploymentModule> };

export function resolveModules(rows: readonly { module: DeploymentModule; enabled: boolean }[]): ModuleAvailability {
  const disabled = new Set(rows.filter(row => !row.enabled).map(row => row.module));
  const configured = new Set(modules.filter(module => !disabled.has(module)));
  const effective = new Set<DeploymentModule>();
  const visit = (module: DeploymentModule, seen: Set<DeploymentModule>): boolean => {
    if (!configured.has(module) || seen.has(module)) return false;
    seen.add(module);
    return moduleDefinitions[module].requires.every(parent => visit(parent, new Set(seen)));
  };
  for (const feature of modules) if (visit(feature, new Set())) effective.add(feature);
  return { configured, effective };
}

export function moduleForPath(path: string): DeploymentModule | null {
  if (path.startsWith('/support/inbox') || path.startsWith('/api/support-gmail/')) return 'SUPPORT_INBOX';
  if (path.startsWith('/support/cases') || path.startsWith('/api/support/')) return 'SUPPORT_CASES';
  if (path.startsWith('/reports/forecast') || path.startsWith('/reports/opportunity-snapshots') || path.startsWith('/reports/pipeline-movement') || path.startsWith('/administration/forecast-snapshots') || path.startsWith('/administration/opportunity-snapshots') || path.startsWith('/administration/history')) return 'FORECASTING';
  if (path.startsWith('/reports/sales-plan') || path.startsWith('/sales-plan') || path.startsWith('/administration/sales-targets')) return 'SALES_PLANS';
  if (path.startsWith('/reports/support-cases') || path.startsWith('/administration/support-case-categories')) return 'SUPPORT_CASES';
  if (path.startsWith('/reports/demo-inventory') || path.startsWith('/administration/imports/demos') || path.startsWith('/demos')) return 'DEMOS';
  if (path.startsWith('/reports/price-exceptions') || path.startsWith('/administration/price-exceptions') || path.startsWith('/administration/imports/price-exceptions') || path.startsWith('/price-exceptions')) return 'PRICE_EXCEPTIONS';
  if (path.startsWith('/administration/imports/products') || path.startsWith('/administration/lookups/product-categories') || path.startsWith('/products')) return 'PRODUCTS';
  if (path.startsWith('/reports/marketing-attribution') || path.startsWith('/reports/lead-sources') || path.startsWith('/marketing')) return 'MARKETING';
  if (path.startsWith('/reports/trade-shows') || path.startsWith('/trade-shows')) return 'TRADE_SHOWS';
  if (path.startsWith('/projects')) return 'PROJECTS';
  if (path.startsWith('/opportunities') || path.startsWith('/pipeline') || path.startsWith('/reports/pipeline-view') || path.startsWith('/administration/sales-stages') || path.startsWith('/administration/outcome-reasons') || path.startsWith('/administration/competitors')) return 'OPPORTUNITIES';
  return null;
}
export function requiredModulesForPath(path: string): readonly DeploymentModule[] {
  const primary = moduleForPath(path);
  const required: DeploymentModule[] = primary ? [primary] : [];
  if (/^\/trade-shows\/\d+\/leads\/\d+\/convert(?:\/|$)/.test(path) || path.startsWith('/reports/marketing-attribution') || path.startsWith('/reports/lead-sources')) required.push('OPPORTUNITIES');
  if (path.startsWith('/reports/marketing-attribution') || path.startsWith('/reports/lead-sources')) required.push('TRADE_SHOWS');
  if (path.startsWith('/reports/sales-plan-sku')) required.push('PRODUCTS');
  if (path.startsWith('/opportunities/product-search')) required.push('PRODUCTS');
  if (path.startsWith('/opportunities/price-exception-search')) required.push('PRICE_EXCEPTIONS');
  return required;
}

export function moduleForSavedView(route: string): DeploymentModule | null {
  return moduleForPath(route === 'support-cases' ? '/support/cases' : route === 'trade-show-follow-up' ? '/trade-shows/my-leads' : `/${route}`);
}
export function moduleForNotificationCategory(category: string): DeploymentModule | null {
  return category === 'OPPORTUNITY' || category === 'opportunities' ? 'OPPORTUNITIES'
    : category === 'SUPPORT_CASE' || category === 'support' ? 'SUPPORT_CASES'
    : category === 'PRICE_EXCEPTION' || category === 'price-exceptions' ? 'PRICE_EXCEPTIONS' : null;
}

export function moduleForAuditEntity(entity: string): DeploymentModule | null {
  const map: Record<string, DeploymentModule> = {
    Opportunity: 'OPPORTUNITIES', Project: 'PROJECTS', 'Support Case': 'SUPPORT_CASES', 'Trade Show Lead': 'TRADE_SHOWS',
    'Price Exception': 'PRICE_EXCEPTIONS', History: 'FORECASTING',
  };
  return map[entity] ?? null;
}

export function qualityIssueAvailable(key: string, availability: ModuleAvailability): boolean {
  if (key.startsWith('opportunity-')) return availability.effective.has('OPPORTUNITIES');
  if (key.startsWith('project-')) return availability.effective.has('PROJECTS');
  if (key === 'task-archived-link' || key === 'activity-archived-link') return availability.effective.has('OPPORTUNITIES') && availability.effective.has('PROJECTS');
  return true;
}

export function moduleForReportType(type: string): readonly DeploymentModule[] {
  const map: Record<string, readonly DeploymentModule[]> = {
    PIPELINE: ['OPPORTUNITIES'], ACCOUNT_ACTIVITY: [], PRODUCT_PERFORMANCE: ['OPPORTUNITIES','PRODUCTS'],
    CHANNEL_PARTNER: ['OPPORTUNITIES'], PROJECT_INITIATIVE: ['PROJECTS','OPPORTUNITIES'],
    PRICE_EXCEPTION_USAGE: ['OPPORTUNITIES','PRODUCTS','PRICE_EXCEPTIONS'], TRADE_SHOW: ['TRADE_SHOWS'],
  };
  return map[type] ?? [];
}
export function reportTypeAvailable(type: string, availability: ModuleAvailability) {
  return moduleForReportType(type).every(module => availability.effective.has(module));
}
export function builtInReportAvailable(type: string, availability: ModuleAvailability) {
  if (type === 'ACCOUNT_ENGAGEMENT') return true;
  if (type === 'DEMO_INVENTORY') return availability.effective.has('DEMOS');
  if (type === 'EXPIRING_PRICE_EXCEPTIONS') return availability.effective.has('PRICE_EXCEPTIONS');
  if (type === 'TRADE_SHOW_PIPELINE') return availability.effective.has('TRADE_SHOWS') && availability.effective.has('OPPORTUNITIES');
  if (type.startsWith('TRADE_SHOW_') || type.startsWith('LEADS_BY_')) return availability.effective.has('TRADE_SHOWS');
  if (type.startsWith('PE_') || type === 'PRICE_OVERRIDES' || type === 'PES_BELOW_MOQ') return reportTypeAvailable('PRICE_EXCEPTION_USAGE', availability);
  if (type === 'ACTIVE_PROJECTS' || type === 'PIPELINE_BY_PROJECT' || type === 'PROJECTS_NEAR_TARGET') return reportTypeAvailable('PROJECT_INITIATIVE', availability);
  if (type === 'PRODUCT_THIS_QUARTER' || type === 'PIPELINE_BY_PRODUCT') return reportTypeAvailable('PRODUCT_PERFORMANCE', availability);
  return availability.effective.has('OPPORTUNITIES');
}

export function dashboardWidgetAvailable(key: string, availability: ModuleAvailability) {
  const requirements: Record<string, readonly DeploymentModule[]> = {
    FORECAST_SUMMARY: ['FORECASTING'], FORECAST_ATTENTION: ['FORECASTING'], FORECAST_MOVEMENT: ['FORECASTING'],
    SALES_PLAN_STATUS: ['SALES_PLANS'], PIPELINE_BY_REP: ['OPPORTUNITIES'], PIPELINE_BY_STAGE: ['OPPORTUNITIES'],
    PIPELINE_BY_PRODUCT_CATEGORY: ['OPPORTUNITIES','PRODUCTS'], CLOSING_OPPORTUNITIES: ['OPPORTUNITIES'],
    MY_TRADE_SHOW_LEADS: ['TRADE_SHOWS'], EXPIRING_PRICE_EXCEPTIONS: ['PRICE_EXCEPTIONS'],
    MARKETING_SUMMARY: ['MARKETING','TRADE_SHOWS'], MARKETING_ACTIVITY: ['MARKETING'],
    SUPPORT_MY_OPEN: ['SUPPORT_CASES'], SUPPORT_INTAKE: ['SUPPORT_CASES'], SUPPORT_PRIORITY: ['SUPPORT_CASES'],
    SUPPORT_OVERDUE: ['SUPPORT_CASES'], SUPPORT_OLDEST: ['SUPPORT_CASES'], SUPPORT_TASKS: ['SUPPORT_CASES'], SUPPORT_ACTIVITY: ['SUPPORT_CASES'],
  };
  return (requirements[key] ?? []).every(module => availability.effective.has(module));
}
