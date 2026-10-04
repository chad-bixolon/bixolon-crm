import type { UserRole } from '@prisma/client';

export type Permission = 'sales-plan.read' | 'sales-plan.allocate' | 'sales-plan.manage' | 'accounts.read' | 'accounts.write' | 'contacts.read' | 'contacts.write' | 'opportunities.read' | 'sales.read' | 'sales.write' | 'pricing.read' | 'tasks.read' | 'tasks.write' | 'products.read' | 'products.write' | 'projects.read' | 'projects.write' | 'users.manage' | 'integrations.manage' | 'marketing.read' | 'marketing.write' | 'trade-shows.read' | 'trade-shows.manage' | 'trade-shows.leads.write' | 'trade-shows.assign' | 'trade-shows.resolve' | 'trade-shows.route';
export type Actor = { id: number; role: UserRole; active: boolean; archivedAt?: Date | null };

const grants: Record<UserRole, readonly Permission[]> = {
  ADMIN: ['sales-plan.read','sales-plan.allocate','sales-plan.manage','accounts.read','accounts.write','contacts.read','contacts.write','sales.read','sales.write','pricing.read','tasks.read','tasks.write','products.read','products.write','projects.read','projects.write','users.manage','integrations.manage','marketing.read','marketing.write','trade-shows.read','trade-shows.manage','trade-shows.leads.write','trade-shows.assign','trade-shows.resolve','trade-shows.route'],
  SALES_MANAGER: ['sales-plan.read','sales-plan.allocate','sales-plan.manage','accounts.read','accounts.write','contacts.read','contacts.write','sales.read','sales.write','pricing.read','tasks.read','tasks.write','products.read','projects.read','projects.write','trade-shows.read','trade-shows.leads.write','trade-shows.assign','trade-shows.resolve','trade-shows.route'],
  SALES: ['sales-plan.read','sales-plan.allocate','accounts.read','accounts.write','contacts.read','contacts.write','sales.read','sales.write','pricing.read','tasks.read','tasks.write','products.read','projects.read','projects.write','trade-shows.read','trade-shows.leads.write','trade-shows.resolve','trade-shows.route'],
  MARKETING_MANAGER: ['accounts.read','contacts.read','opportunities.read','pricing.read','tasks.read','tasks.write','products.read','projects.read','marketing.read','marketing.write','trade-shows.read','trade-shows.manage','trade-shows.leads.write','trade-shows.assign','trade-shows.resolve','trade-shows.route'],
  READ_ONLY: ['sales-plan.read','accounts.read','contacts.read','sales.read','pricing.read','tasks.read','products.read','projects.read','trade-shows.read'],
};
export function can(actor: Actor | null | undefined, permission: Permission) {
  if (!actor?.active || actor.archivedAt) return false;
  return grants[actor.role]?.includes(permission) === true ||
    (permission === 'opportunities.read' && grants[actor.role]?.includes('sales.read') === true);
}
export function assertPermission(actor: Actor | null | undefined, permission: Permission) { if (!can(actor,permission)) throw new Error('Access denied'); }
export function permissionForPath(path: string): Permission | null {
  if (path.startsWith('/sales-plan/import')) return 'sales-plan.manage';
  if (path.startsWith('/sales-plan/sync')) return 'sales-plan.manage';
  if (path.startsWith('/sales-plan')) return 'sales-plan.read';
  if (path === '/marketing/campaigns' || /^\/marketing\/campaigns\/\d+$/.test(path)) return 'trade-shows.read';
  if (path.startsWith('/marketing')) return 'marketing.read';
  if (path.startsWith('/trade-shows')) return 'trade-shows.read';
  if (path.startsWith('/reports/engagement') || path.startsWith('/reports/new')) return 'sales.write';
  if (path.startsWith('/reports')) return 'sales.read';
  if (path.startsWith('/administration')) return 'users.manage';
  if (path.startsWith('/integrations')) return 'integrations.manage';
  if (path.startsWith('/pipeline')) return 'sales.read';
  if (path.startsWith('/opportunities')) return 'opportunities.read';
  if (path.startsWith('/demos')) return 'sales.read';
  if (path.startsWith('/projects')) return 'projects.read';
  if (path.startsWith('/accounts')) return 'accounts.read';
  if (path.startsWith('/contacts')) return 'contacts.read';
  if (path.startsWith('/tasks') || path.startsWith('/activities') || path.startsWith('/notes')) return 'tasks.read';
  if (path.startsWith('/products')) return 'products.read';
  if (path.startsWith('/price-exceptions')) return 'pricing.read';
  return null;
}
export function routeAccess(path: string, actor: Actor | null): 'sign-in' | 'denied' | 'allowed' {
  if (path === '/sign-in' || path === '/access-denied' || path === '/brand/bixolon-logo.png' || path === '/icon.png' || path.startsWith('/api/auth/') || path === '/api/health') return 'allowed';
  if (!actor) return 'sign-in';
  if (!actor.active || actor.archivedAt) return 'denied';
  if (path === '/demos' && actor.role !== 'ADMIN') return 'denied';
  if (path.startsWith('/demos/') && !/^\/demos\/\d+$/.test(path)) return 'denied';
  if (path === '/trade-shows/my-leads' && !['ADMIN','SALES_MANAGER','SALES'].includes(actor.role)) return 'denied';
  if (path === '/reports/marketing-attribution' || path === '/reports/lead-sources') return can(actor, 'marketing.read') && can(actor, 'contacts.read') && can(actor, 'opportunities.read') ? 'allowed' : 'denied';
  // The Reports landing page, saved reports, and builder perform report-type
  // authorization server-side. This lets Marketing use Trade Show reporting
  // without granting access to Pipeline or other sales reports.
  if (path === '/reports' || path === '/reports/trade-shows' || /^\/reports\/\d+$/.test(path) || path === '/reports/new') {
    if (path === '/reports/new' && actor.role === 'READ_ONLY') return 'denied';
    return can(actor, 'sales.read') || can(actor, 'trade-shows.read') ? 'allowed' : 'denied';
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
    const write: Permission = path.startsWith('/accounts') ? 'accounts.write' : path.startsWith('/contacts') ? 'contacts.write' : path.startsWith('/marketing') ? 'marketing.write' : path.startsWith('/opportunities') || path.startsWith('/demos') ? 'sales.write' : path.startsWith('/projects') ? 'projects.write' : path.startsWith('/products') ? 'products.write' : path.startsWith('/administration') ? 'users.manage' : 'tasks.write';
    if (!can(actor, write)) return 'denied';
  }
  return 'allowed';
}
export function opportunityScope(actor: Actor) { return actor.role === 'SALES' ? { ownerId: actor.id } : {}; }
export function taskScope(actor: Actor) { return actor.role === 'SALES' ? { assignedToId: actor.id } : {}; }
