import type { Prisma, UserRole } from '@prisma/client';
import { can, taskScope, type Actor } from './authorization';
import { canRunReportType, canViewBuiltInReport } from './reporting';
import { reportAccountScope } from './engagement';
import { dashboardOpenTaskWhere } from './work';

export type DashboardSection = 'forecast' | 'reps' | 'closing' | 'stage' | 'category' | 'stale' | 'tasks' | 'activities' | 'admin' | 'marketing';
export type DashboardView = { title: string; sections: readonly DashboardSection[] };

// A role chooses the default presentation. Authorization still decides which
// data and actions are accessible; future role-view settings must not grant access.
const views: Record<UserRole, DashboardView> = {
  SALES: { title: 'My sales dashboard', sections: ['forecast','closing','stale','tasks','activities','stage'] },
  SALES_MANAGER: { title: 'Team sales dashboard', sections: ['forecast','reps','closing','stale','tasks','activities','stage','category'] },
  ADMIN: { title: 'Sales dashboard', sections: ['forecast','reps','closing','stale','tasks','activities','stage','category','admin'] },
  READ_ONLY: { title: 'Sales overview', sections: ['forecast','reps','closing','stage','category'] },
  MARKETING_MANAGER: { title: 'Marketing overview', sections: ['marketing'] },
};

export function canShowDashboardSection(actor: Actor, section: DashboardSection) {
  if (!views[actor.role].sections.includes(section)) return false;
  if (['forecast','reps','closing','stage','category'].includes(section)) return canRunReportType(actor, 'PIPELINE');
  if (section === 'stale') return canViewBuiltInReport(actor, 'ACCOUNT_ENGAGEMENT');
  if (section === 'tasks' || section === 'activities') return can(actor, 'tasks.read');
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
  return { ...reportAccountScope(actor), archivedAt: null, status: 'ACTIVE' };
}

export function dashboardTaskWhere(actor: Actor, today: Date, repIds: number[]): Prisma.TaskWhereInput {
  if (!can(actor, 'tasks.read')) throw new Error('Access denied');
  return { ...dashboardOpenTaskWhere(), dueDate: { lt: today }, ...taskScope(actor), ...(actor.role === 'SALES' ? {} : { assignedToId: { in: repIds } }) };
}

export function dashboardActivityWhere(actor: Actor, repIds: number[]): Prisma.ActivityWhereInput {
  if (!can(actor, 'tasks.read')) throw new Error('Access denied');
  return { archivedAt: null, userId: actor.role === 'SALES' ? actor.id : { in: repIds } };
}

export function pipelineReportHref(input: { currency: string; ownerId?: number; groupBy?: 'owner'|'stage'|'productCategory'; commit?: boolean; team?: boolean }) {
  const p = new URLSearchParams({ configured: '1', status: 'OPEN', closeDatePreset: 'THIS_QUARTER', currency: input.currency, forecastCategory: input.commit ? 'COMMIT' : 'IN_FORECAST' });
  if (input.team) p.set('activeSalesRep', '1');
  if (input.ownerId) p.set('ownerId', String(input.ownerId));
  if (input.groupBy) p.set('groupBy', input.groupBy);
  return `/reports/new?${p}`;
}
