import Link from 'next/link';
import { getModuleAvailability, moduleForPath } from '@/lib/module-availability';

export type QuickAction = { label: string; href: string };

export async function QuickActions({ actions }: { actions: QuickAction[] }) {
  const availability = await getModuleAvailability();
  actions = actions.filter(action => { const feature = moduleForPath(action.href); return !feature || availability.effective.has(feature); });
  if (!actions.length) return null;
  return <section aria-label="Quick Actions" className="mb-5 flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-3">
    <h2 className="mr-2 text-sm font-semibold text-slate-700">Quick Actions</h2>
    {actions.map(action => <Link key={action.label} className="btn-secondary min-h-11" href={action.href}>{action.label}</Link>)}
  </section>;
}
