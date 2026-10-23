import type { UserRole } from '@prisma/client';

export type Permission = 'deployment.manage' | 'users.import' | 'users.export' | 'support-mailbox.manage' | 'support-cases.all.read' | 'sales-plan.reports.read' | 'sales-plan.sku.read' | 'configuration.manage' | 'support-oversight.manage' | 'demos.read' | 'reports.operational.read' | 'reports.engagement.read' | 'reports.create' | 'reports.share' | 'snapshots.read' | 'pipeline-movement.read' | 'forecast.read' | 'support-inbox.write' | 'data-quality.manage' | 'system-health.read' | 'maintenance.manage' | 'support-work.write' | 'support-cases.read' | 'support-cases.write' | 'support-categories.manage' | 'sales-plan.read' | 'sales-plan.allocate' | 'sales-plan.manage' | 'accounts.read' | 'accounts.write' | 'contacts.read' | 'contacts.write' | 'opportunities.read' | 'sales.read' | 'sales.write' | 'pricing.read' | 'tasks.read' | 'tasks.write' | 'products.read' | 'products.write' | 'projects.read' | 'projects.write' | 'users.manage' | 'integrations.manage' | 'marketing.read' | 'marketing.write' | 'trade-shows.read' | 'trade-shows.manage' | 'trade-shows.leads.write' | 'trade-shows.assign' | 'trade-shows.resolve' | 'trade-shows.route';
export type Actor = { id: number; role: UserRole; active: boolean; archivedAt?: Date | null; delegatedUserAdministrationEnabled?: boolean };

export const predefinedCapabilities: Record<UserRole, readonly Permission[]> = {
  ADMIN: ['deployment.manage','users.import','users.export','support-mailbox.manage','support-cases.all.read','sales-plan.reports.read','sales-plan.sku.read','configuration.manage','support-oversight.manage','demos.read','opportunities.read','support-work.write','reports.operational.read','reports.engagement.read','reports.create','reports.share','snapshots.read','pipeline-movement.read','forecast.read','support-inbox.write','data-quality.manage','system-health.read','maintenance.manage','support-cases.read','support-cases.write','support-categories.manage','sales-plan.read','sales-plan.allocate','sales-plan.manage','accounts.read','accounts.write','contacts.read','contacts.write','sales.read','sales.write','pricing.read','tasks.read','tasks.write','products.read','products.write','projects.read','projects.write','users.manage','integrations.manage','marketing.read','marketing.write','trade-shows.read','trade-shows.manage','trade-shows.leads.write','trade-shows.assign','trade-shows.resolve','trade-shows.route'],
  SUPPORT_MANAGER: ['support-cases.all.read','support-oversight.manage','support-categories.manage','support-inbox.write','support-work.write','accounts.read','contacts.read','products.read','support-cases.read','support-cases.write'],
  EXECUTIVE: ['support-cases.all.read','sales-plan.reports.read','sales-plan.sku.read','demos.read','accounts.read','contacts.read','opportunities.read','sales.read','projects.read','tasks.read','products.read','reports.operational.read','reports.engagement.read','snapshots.read','pipeline-movement.read','forecast.read','sales-plan.read','support-cases.read','marketing.read','trade-shows.read'],
  SUPPORT: ['support-cases.all.read','support-inbox.write','support-work.write','accounts.read','contacts.read','products.read','support-cases.read','support-cases.write'],
  SALES_MANAGER: ['sales-plan.reports.read','sales-plan.sku.read','opportunities.read','support-work.write','reports.operational.read','reports.engagement.read','reports.create','reports.share','snapshots.read','pipeline-movement.read','forecast.read','support-cases.read','sales-plan.read','sales-plan.allocate','sales-plan.manage','accounts.read','accounts.write','contacts.read','contacts.write','sales.read','sales.write','pricing.read','tasks.read','tasks.write','products.read','projects.read','projects.write','trade-shows.read','trade-shows.leads.write','trade-shows.assign','trade-shows.resolve','trade-shows.route'],
  SALES: ['opportunities.read','support-work.write','reports.operational.read','reports.engagement.read','reports.create','pipeline-movement.read','forecast.read','support-cases.read','sales-plan.read','sales-plan.allocate','accounts.read','accounts.write','contacts.read','contacts.write','sales.read','sales.write','pricing.read','tasks.read','tasks.write','products.read','projects.read','projects.write','trade-shows.read','trade-shows.leads.write','trade-shows.resolve','trade-shows.route'],
  MARKETING_MANAGER: ['support-work.write','reports.create','reports.share','support-cases.read','accounts.read','contacts.read','opportunities.read','pricing.read','tasks.read','tasks.write','products.read','projects.read','marketing.read','marketing.write','trade-shows.read','trade-shows.manage','trade-shows.leads.write','trade-shows.assign','trade-shows.resolve','trade-shows.route'],
  READ_ONLY: ['sales-plan.reports.read','opportunities.read','forecast.read','support-cases.read','sales-plan.read','accounts.read','contacts.read','sales.read','pricing.read','tasks.read','products.read','projects.read','trade-shows.read'],
};
export function can(actor: Actor | null | undefined, permission: Permission) {
  if (!actor?.active || actor.archivedAt) return false;
  if ((permission === 'users.manage' || permission === 'users.export') && actor.role === 'SALES_MANAGER' && actor.delegatedUserAdministrationEnabled) return true;
  return predefinedCapabilities[actor.role]?.includes(permission) === true;
}
export function assertPermission(actor: Actor | null | undefined, permission: Permission) { if (!can(actor,permission)) throw new Error('Access denied'); }
export function permissionForPath(path: string): Permission | null {
  if (path.startsWith('/administration/company-branding') || path.startsWith('/administration/trusted-domains') || path.startsWith('/administration/modules')) return 'deployment.manage';
  if (path.startsWith('/support/cases')) return 'support-cases.read';
  if (path.startsWith('/support-cases')) return 'support-cases.read';
  if (path.startsWith('/calendar-matches')) return 'sales.read';
  if (path.startsWith('/sales-plan/import')) return 'sales-plan.manage';
  if (path.startsWith('/sales-plan/sync')) return 'sales-plan.manage';
  if (path.startsWith('/sales-plan')) return 'sales-plan.read';
  if (path === '/marketing/campaigns' || /^\/marketing\/campaigns\/\d+$/.test(path)) return 'trade-shows.read';
  if (path.startsWith('/marketing')) return 'marketing.read';
  if (path.startsWith('/trade-shows')) return 'trade-shows.read';
  if (path.startsWith('/reports/engagement')) return 'reports.engagement.read';
  if (path.startsWith('/reports/forecast')) return 'forecast.read';
  if (path.startsWith('/administration/data-quality')) return 'data-quality.manage';
  if (path.startsWith('/administration/system-health')) return 'system-health.read';
  if (path.startsWith('/reports/price-exceptions-expiring')) return 'pricing.read';
  if (path.startsWith('/reports/support-cases')) return 'support-cases.read';
  if (path.startsWith('/reports')) return 'sales.read';
  if (path.startsWith('/administration/support-case-categories')) return 'support-categories.manage';
  if (path.startsWith('/administration/users/import')) return 'users.import';
  if (path.startsWith('/administration/users/export')) return 'users.export';
  if (path.startsWith('/administration/users')) return 'users.manage';
  if (path.startsWith('/administration')) return 'configuration.manage';
  if (path.startsWith('/integrations')) return 'integrations.manage';
  if (path.startsWith('/pipeline')) return 'sales.read';
  if (path.startsWith('/opportunities')) return 'opportunities.read';
  if (path === '/demos') return 'demos.read';
  if (path.startsWith('/demos/')) return 'sales.read';
  if (path.startsWith('/projects')) return 'projects.read';
  if (path.startsWith('/accounts')) return 'accounts.read';
  if (path.startsWith('/contacts')) return 'contacts.read';
  if (path.startsWith('/tasks') || path.startsWith('/activities') || path.startsWith('/notes')) return 'tasks.read';
  if (path.startsWith('/products')) return 'products.read';
  if (path.startsWith('/price-exceptions')) return 'pricing.read';
  return null;
}
export function routeAccess(path: string, actor: Actor | null): 'sign-in' | 'denied' | 'allowed' {
  if (path === '/sign-in' || path === '/access-denied' || path === '/brand/bixolon-logo.png' || path === '/icon.png' || path === '/api/branding/logo' || path.startsWith('/api/auth/') || path === '/api/health') return 'allowed';
  if (!actor) return 'sign-in';
  if (!actor.active || actor.archivedAt) return 'denied';
  if (path.startsWith('/reports/pipeline-movement')) return can(actor, 'pipeline-movement.read') ? 'allowed' : 'denied';
  if (path.startsWith('/reports/opportunity-snapshots') || path.startsWith('/reports/forecast-snapshots')) return can(actor, 'snapshots.read') ? 'allowed' : 'denied';
  if (path.startsWith('/api/support-gmail/')) return process.env.SUPPORT_GMAIL_ENABLED === 'true' && can(actor, 'support-mailbox.manage') ? 'allowed' : 'denied';
  if (path.startsWith('/support/inbox')) return process.env.SUPPORT_GMAIL_ENABLED === 'true' && can(actor, 'support-inbox.write') ? 'allowed' : 'denied';
  if (can(actor, 'support-oversight.manage') && /^\/activities\/\d+\/edit$/.test(path)) return 'allowed';
  if (!can(actor, 'tasks.write') && can(actor, 'support-work.write') && (['/activities/new', '/tasks/new', '/notes/new'].includes(path) || /^\/(tasks|activities)\/\d+$/.test(path) || /^\/tasks\/\d+\/edit$/.test(path))) return 'allowed';
  if (path === '/demos' && !can(actor, 'demos.read')) return 'denied';
  if (path.startsWith('/demos/') && !/^\/demos\/\d+$/.test(path)) return 'denied';
  if (path === '/trade-shows/my-leads' && !['ADMIN','SALES_MANAGER','SALES','MARKETING_MANAGER'].includes(actor.role)) return 'denied';
  if (path === '/reports/marketing-attribution' || path === '/reports/lead-sources') return can(actor, 'marketing.read') && can(actor, 'contacts.read') && can(actor, 'opportunities.read') ? 'allowed' : 'denied';
  // The Reports landing page, saved reports, and builder perform report-type
  // authorization server-side. This lets Marketing use Trade Show reporting
  // without granting access to Pipeline or other sales reports.
  if (path === '/reports' || path === '/reports/trade-shows' || /^\/reports\/\d+$/.test(path) || path === '/reports/new') {
    if (path === '/reports/new' && !can(actor, 'reports.create') && !can(actor, 'reports.operational.read')) return 'denied';
    return can(actor, 'sales.read') || can(actor, 'trade-shows.read') || can(actor, 'support-cases.read') ? 'allowed' : 'denied';
  }
  const read = permissionForPath(path);
  if (read && !can(actor, read)) return 'denied';
  if (path.startsWith('/trade-shows') && path.endsWith('/edit')) {
    const editPermission = /^\/trade-shows\/\d+\/leads\/\d+\/edit$/.test(path) ? 'trade-shows.leads.write' : 'trade-shows.manage';
    if (!can(actor, editPermission)) return 'denied';
  }
  if (path.startsWith('/trade-shows') && path.endsWith('/new') && !can(actor, 'trade-shows.manage')) return 'denied';
  if (path === '/trade-shows/import-mappings' && !can(actor, 'trade-shows.manage')) return 'denied';
  if (/^\/trade-shows\/\d+\/import$/.test(path) && !can(actor, 'trade-shows.manage')) return 'denied';
  if (path.startsWith('/trade-shows')) return 'allowed';
  if (path.endsWith('/new') || path.endsWith('/edit')) {
    const write: Permission = path.startsWith('/support/cases') ? 'support-cases.write' : path.startsWith('/accounts') ? 'accounts.write' : path.startsWith('/contacts') ? 'contacts.write' : path.startsWith('/marketing') ? 'marketing.write' : path.startsWith('/opportunities') || path.startsWith('/demos') ? 'sales.write' : path.startsWith('/projects') ? 'projects.write' : path.startsWith('/products') ? 'products.write' : path.startsWith('/administration') ? 'users.manage' : 'tasks.write';
    if (!can(actor, write)) return 'denied';
  }
  return 'allowed';
}
// Ownership scopes responsibility, attribution, personal views and owner-only actions.
// It is not the read policy for Opportunity browsing or relationship context.
export function opportunityScope(actor: Actor) { return actor.role === 'SALES' ? { ownerId: actor.id } : {}; }
export function opportunityReadWhere(actor: Actor) { return can(actor, 'opportunities.read') ? {} : { id: -1 }; }
export function taskScope(actor: Actor) { return actor.role === 'SALES' ? { assignedToId: actor.id } : {}; }

export function isCaseOnlyWorker(actor: Actor) { return can(actor, 'support-work.write') && !can(actor, 'tasks.read'); }
