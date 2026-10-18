import Link from 'next/link';
import { PageHeader } from '@/components/shell';
import { HelpLink } from '@/components/help-link';
import { NAV_CATEGORIES } from '@/lib/navigation-categories';

// Both report routes share navigation, while keeping their own filters and engines.
export function PipelineMovementHeader({ view, filters, currentQuery }: {
  view: 'weekly' | 'history';
  filters?: { year: number; quarter: string; currencyCode: string; ownerId?: number };
  currentQuery?: Readonly<Record<string, string | undefined>>;
}) {
  const sharedQuery = filters ? new URLSearchParams({ year: String(filters.year), quarter: filters.quarter, currencyCode: filters.currencyCode, ownerId: filters.ownerId === undefined ? 'team' : String(filters.ownerId) }).toString() : '';
  const activeQuery = new URLSearchParams(Object.fromEntries(Object.entries(currentQuery ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))).toString();
  return <>
    <PageHeader eyebrow={NAV_CATEGORIES.reports} title="Pipeline Movement" description="Follow pipeline changes and Opportunity outcomes." action={<Link className="btn-secondary" href="/reports">Reports</Link>}/>
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <nav aria-label="Pipeline Movement views" className="flex flex-wrap gap-2">{[
        { key: 'weekly', label: 'Weekly Comparison', route: '/reports/pipeline-movement' },
        { key: 'history', label: 'History & Outcomes', route: '/reports/pipeline-movement/history' },
      ].map(item => {
        const active = item.key === view, query = active ? activeQuery : sharedQuery;
        return <Link key={item.key} href={`${item.route}${query ? `?${query}` : ''}`} aria-current={active ? 'page' : undefined} style={{ minHeight: 44 }} className={`${active ? 'btn-filter-primary' : 'btn-filter-secondary'} min-h-11`}>{item.label}</Link>;
      })}</nav>
      <HelpLink topic="pipeline-movement">Pipeline Movement Help</HelpLink>
    </div>
  </>;
}
