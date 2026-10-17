import { can, permissionForPath, type Actor } from './authorization';
import { selectedClosePeriod, validClosePeriod } from './close-period';
import { validTaskDuePeriod } from './task-due-period';

export const savedViewRoutes = {
  accounts: { path: '/accounts', keys: ['q','view','status','salesRepId','role','territory','industry','strategic'] },
  contacts: { path: '/contacts', keys: ['q','active','accountId','salesRepId','marketingPreference','title','primary','assignment','sort','dir'] },
  opportunities: { path: '/opportunities', keys: ['q','stageId','competitorId','ownerId','forecastCategory','closePeriod','closeFrom','closeTo','accountId','projectId','archived'] },
  tasks: { path: '/tasks', keys: ['q','visibility','status','priority','assignedToId','accountId','opportunityId','duePeriod','dueFrom','dueTo'] },
  projects: { path: '/projects', keys: ['q','status','ownerId','accountId','archived'] },
  'price-exceptions': { path: '/price-exceptions', keys: ['q','status','distributor','varName','endUser','expiration','unresolved','salesRep'] },
  demos: { path: '/demos', keys: ['q','status'] },
  'support-cases': { path: '/support/cases', keys: ['q','assignedToId','status','priority','account','categoryId','product','openedFrom','openedTo','archive','sort'] },
  products: { path: '/products', keys: ['q','active','catalogSource','category','priceException'] },
  campaigns: { path: '/marketing/campaigns', keys: ['q','status','year','archived'] },
  pipeline: { path: '/pipeline', keys: ['ownerId','stageId','territory','closeFrom','closeTo'] },
  'calendar-matches': { path: '/calendar-matches', keys: ['status','q','from','to','accountId'] },
} as const;

export type SavedViewRoute = keyof typeof savedViewRoutes;
export type SavedQuery = Record<string, string>;
const defaults: Record<string, SavedQuery> = { tasks: { visibility: 'active' }, 'price-exceptions': { expiration: 'all' }, 'support-cases': { archive: 'active', sort: 'current' }, 'calendar-matches': { status: 'review' } };
const idKeys = new Set(['accountId','projectId','opportunityId','ownerId','assignedToId','salesRepId','stageId','competitorId','categoryId']);
const dateKeys = new Set(['closeFrom','closeTo','dueFrom','dueTo','openedFrom','openedTo','from','to']);

export function isSavedViewRoute(value: string): value is SavedViewRoute { return Object.hasOwn(savedViewRoutes, value); }
export function canUseSavedViews(actor: Actor, route: SavedViewRoute) {
  if (route === 'demos' && actor.role !== 'ADMIN') return false;
  const permission = permissionForPath(savedViewRoutes[route].path);
  return !!permission && can(actor, permission);
}
export function normalizeSavedQuery(route: SavedViewRoute, input: unknown): SavedQuery {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const record = input as Record<string, unknown>;
  const output: SavedQuery = {};
  for (const key of savedViewRoutes[route].keys) {
    const value = record[key];
    if (typeof value !== 'string') continue;
    const clean = value.trim();
    if (!clean || clean === defaults[route]?.[key] || clean.length > (key === 'q' ? 120 : 100)) continue;
    if (idKeys.has(key) && !/^[1-9]\d{0,9}$/.test(clean) && !(route === 'opportunities' && key === 'projectId' && clean === 'none') && !(route === 'contacts' && key === 'accountId' && clean === 'unassigned')) continue;
    if (dateKeys.has(key) && !/^\d{4}-\d{2}-\d{2}$/.test(clean)) continue;
    if (key === 'closePeriod' && !validClosePeriod(clean)) continue;
    if (key === 'duePeriod' && !validTaskDuePeriod(clean)) continue;
    output[key] = clean;
  }
  if (route === 'opportunities') {
    const period = selectedClosePeriod(output);
    if (period) output.closePeriod = period;
    if (period !== 'custom') { delete output.closeFrom; delete output.closeTo; }
  }
  if (route === 'tasks') {
    // Store only the meaning of a relative period. Never resolve it to dates.
    // Legacy absolute views keep their original shape and dates.
    if (record.duePeriod === '' || output.duePeriod && output.duePeriod !== 'custom') {
      delete output.dueFrom; delete output.dueTo;
    }
  }
  return output;
}
export function savedQueryHref(route: SavedViewRoute, query: SavedQuery) {
  const params = new URLSearchParams(normalizeSavedQuery(route, query));
  return savedViewRoutes[route].path + (params.size ? `?${params}` : '');
}
