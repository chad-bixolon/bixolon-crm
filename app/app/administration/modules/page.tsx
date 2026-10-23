import Link from 'next/link';
import { Content, PageHeader } from '@/components/shell';
import { requirePermission } from '@/lib/current-user';
import { getModuleAvailability, moduleDefinitions, modules } from '@/lib/module-availability';
import { changeModuleVisibility } from './actions';
import { NAV_CATEGORIES } from '@/lib/navigation-categories';

export const dynamic = 'force-dynamic';
export default async function ModulesPage({ searchParams }: { searchParams: Promise<{ saved?: string }> }) {
  await requirePermission('deployment.manage');
  const availability = await getModuleAvailability();
  const saved = (await searchParams).saved === '1';
  return <Content>
    <PageHeader eyebrow={NAV_CATEGORIES.administration} title="Modules" description="Choose which modules are available in this deployment. Disabling a module hides it from normal use but does not delete its data." action={<Link className="btn-secondary" href="/administration">Administration</Link>}/>
    {saved && <p role="status" className="mb-4 rounded-md border border-green-300 bg-green-50 p-3 text-sm text-green-900">Module setting saved.</p>}
    <div className="grid gap-3">{modules.map(module => {
      const definition = moduleDefinitions[module];
      const configured = availability.configured.has(module);
      const effective = availability.effective.has(module);
      const missing = definition.requires.filter(parent => !availability.effective.has(parent));
      return <section className="panel flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5" key={module} aria-label={definition.name}>
        <div className="min-w-0"><h2 className="text-base font-semibold">{definition.name}</h2><p className="mt-1 text-sm text-slate-600">{definition.description}</p>
          {!!definition.requires.length && <p className="mt-2 text-xs text-slate-600">Requires {definition.requires.map(parent => moduleDefinitions[parent].name).join(', ')}.</p>}
          {configured && !effective && <p className="mt-2 text-sm font-medium text-amber-800">Unavailable while {missing.map(parent => moduleDefinitions[parent].name).join(', ')} is disabled. Your Enabled choice is preserved.</p>}
        </div>
        <form action={changeModuleVisibility} className="flex shrink-0 items-center gap-3"><span className={`text-sm font-semibold ${configured ? 'text-green-800' : 'text-slate-600'}`}>{configured ? 'Enabled' : 'Disabled'}</span><input type="hidden" name="module" value={module}/><input type="hidden" name="enabled" value={String(!configured)}/><button type="submit" className="btn-secondary min-h-11 min-w-24" aria-label={`${configured ? 'Disable' : 'Enable'} ${definition.name}`}>{configured ? 'Disable' : 'Enable'}</button></form>
      </section>;
    })}</div>
  </Content>;
}
