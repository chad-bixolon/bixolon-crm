import { CurrencyControl } from '@/components/currency-control';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Content } from '@/components/shell';
import { PipelineMovementHeader } from '@/components/pipeline-movement-header';
import { currentUser } from '@/lib/current-user';
import { prisma } from '@/lib/prisma';
import { formatPlanCurrency } from '@/lib/display-format';
import { quarters } from '@/lib/business-quarter';
import { snapshotAccounts } from '@/lib/opportunity-snapshots';
import { financialLabels, movementLabels } from '@/lib/pipeline-movement';
import { canReadPipelineMovement, loadPipelineMovement, MovementInputError, type MovementQuery } from '@/lib/pipeline-movement-report';

export const dynamic = 'force-dynamic';
const categoryName = (value: string) => ({ PIPELINE: 'Pipeline', BEST_CASE: 'Best Case', COMMIT: 'Commit', OMITTED: 'Omitted', CLOSED: 'Closed' })[value] ?? value;
const date = (value?: Date | null) => value?.toISOString().slice(0, 10) ?? '—';
export default async function PipelineMovementPage({ searchParams }: { searchParams: Promise<MovementQuery> }) {
  const actor = await currentUser();
  if (!canReadPipelineMovement(actor)) notFound();
  const f = await searchParams;
  let report;
  try { report = await loadPipelineMovement(prisma, actor, f); }
  catch (error) {
    if (!(error instanceof MovementInputError)) throw error;
    return <Content><PipelineMovementHeader view="weekly" currentQuery={f}/><p className="panel p-5" role="alert">{error.message}</p><Link className="btn-secondary mt-4" href="/reports/pipeline-movement">Reset comparison</Link></Content>;
  }
  const { result, before, after, runs, reps, ownerId, year, quarter, currencyCode, currencies } = report;
  const money = (value: string) => formatPlanCurrency(value, currencyCode);
  const pageCount = Math.max(1, Math.ceil((result?.rows.length ?? 0) / 50));
  const page = Math.min(pageCount, Math.max(1, Math.floor(Number(f.page) || 1)));
  const href = (next: number) => `/reports/pipeline-movement?${new URLSearchParams({ before: String(before!.id), after: String(after!.id), year: String(year), quarter, currencyCode, ownerId: ownerId === undefined ? 'team' : String(ownerId), page: String(next) })}#movement-table`;
  const runLabel = (run: typeof runs[number]) => `${date(run.snapshotWeek)} · ${run.source === 'SCHEDULED' ? 'Automated' : 'Manual'} · #${run.id}`;
  const groups = [ ['positive', 'Largest positive movements'], ['negative', 'Largest negative movements'], ['slipped', 'Deals that slipped'], ['upgrades', 'Forecast upgrades'], ['downgrades', 'Forecast downgrades'], ['won', 'Closed Won'], ['lost', 'Closed Lost'] ] as const;
  return <Content>
    <PipelineMovementHeader view="weekly" filters={{ year, quarter, currencyCode, ownerId }} currentQuery={f}/>
    <form method="get" className="panel filter-panel filter-grid mb-5" aria-label="Weekly comparison filters">
      <label className="label">Later snapshot<select className="field filter-control" name="after" defaultValue={after?.id ?? ''}><option value="" disabled>Choose snapshot</option>{runs.map(run => <option key={run.id} value={run.id}>{runLabel(run)}</option>)}</select></label>
      <label className="label">Earlier snapshot<select className="field filter-control" name="before" defaultValue={before?.id ?? ''}><option value="">Immediately prior snapshot</option>{runs.map(run => <option key={run.id} value={run.id}>{runLabel(run)}</option>)}</select></label>
      <label className="label">Salesperson<select className="field filter-control" name="ownerId" defaultValue={ownerId ?? 'team'}>{actor.role !== 'SALES' && <option value="team">All eligible reps</option>}{reps.map(rep => <option key={rep.id} value={rep.id}>{rep.firstName} {rep.lastName}{rep.id === actor.id ? ' (you)' : ''}</option>)}</select></label>
      <label className="label">Year<input className="field filter-control" type="number" min="2000" max="2100" name="year" defaultValue={year}/></label>
      <label className="label">Quarter<select className="field filter-control" name="quarter" defaultValue={quarter}>{quarters.map(q => <option key={q}>{q}</option>)}</select></label>
      <CurrencyControl name="currencyCode" value={currencyCode} historicalCodes={currencies}><label className="label">Currency<select className="field filter-control" name="currencyCode" defaultValue={currencyCode}>{currencies.map(code => <option key={code}>{code}</option>)}</select></label></CurrencyControl>
      <div className="filter-actions col-span-full flex-wrap"><button className="btn-primary">Compare snapshots</button><Link href="/reports/pipeline-movement" className="text-sm text-orange-800 underline">Latest comparison</Link></div>
    </form>
    {!result ? <p className="panel p-5" role="status">{after ? 'No prior weekly snapshot available yet. Two weekly snapshots are needed to show movement.' : 'No weekly snapshots are available yet. Weekly Comparison will be available after two snapshots.'}</p> : <>
      <p className="mb-3 text-sm text-slate-600">{runLabel(before!)} → {runLabel(after!)} · {year} {quarter} · {currencyCode} · {ownerId === undefined ? 'All eligible reps' : reps.find(rep => rep.id === ownerId) ? `${reps.find(rep => rep.id === ownerId)!.firstName} ${reps.find(rep => rep.id === ownerId)!.lastName}` : 'My pipeline'}.</p>
      <p className="mb-4 text-sm text-slate-600">Pipeline includes Best Case and Commit. A removed Opportunity is not necessarily Lost; weekly snapshots do not include every loss. See Help for inclusion rules.</p>
      <section className="panel mb-5 p-5" aria-label="Pipeline reconciliation">
        <h2 className="text-lg font-semibold">Pipeline reconciliation</h2>
        <p className="mt-1 text-sm text-slate-600">Starting Pipeline + net movement = Ending Pipeline. Each Opportunity contributes once.</p>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{[['Starting Pipeline', result.starting], ...Object.entries(financialLabels).map(([key, label]) => [label, result.totals[key as keyof typeof financialLabels]]), ['Ending Pipeline', result.ending]].map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-sm text-slate-600">{label}</dt><dd className="mt-1 break-words text-xl font-semibold tabular-nums" data-measure={label} data-value={value}>{money(value)}</dd></div>)}</dl>
        <p className="mt-4 text-sm font-medium" role="status">Reconciled · Net movement {money(result.change)}</p>
        <details className="mt-3 text-sm"><summary className="cursor-pointer text-orange-800">How the math works</summary><p className="mt-2">Pipeline Impact is the later value minus the earlier value for the selected filters. Each Opportunity contributes once, even when several details change. Open Pipeline Movement Help for the full reconciliation rules.</p></details>
      </section>
      <section className="panel mb-5 min-w-0 overflow-x-auto" aria-label="Forecast composition">
        <h2 className="p-4 text-lg font-semibold">Forecast composition</h2>
        <p className="px-4 pb-3 text-sm text-slate-600">See how value moved between categories. Best Case → Commit changes the category totals without changing total Pipeline.</p>
        <table className="w-full min-w-[750px] text-sm"><thead><tr>{['Category', 'Previous', 'Current', 'Moved in', 'Moved out', 'Retained value change'].map(label => <th key={label} className="p-3 text-left">{label}</th>)}</tr></thead><tbody>{result.forecast.map(item => <tr key={item.category} className="border-t"><th className="p-3 text-left font-medium">{categoryName(item.category)}</th>{(['previous', 'current', 'into', 'out', 'retained'] as const).map(key => <td key={key} className="p-3 tabular-nums">{money(item[key])}</td>)}</tr>)}</tbody></table>
      </section>
      <section className="mb-5" aria-label="Management movements"><h2 className="mb-3 text-lg font-semibold">Opportunities behind the movement</h2><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{groups.map(([key, title]) => <section className="panel min-w-0 p-4" key={key}><h3 className="font-semibold">{title}</h3><ul className="mt-2 space-y-2 text-sm">{result.groups[key].map(row => <li key={row.opportunityId}><Link className="text-orange-800 underline" href={`/opportunities/${row.opportunityId}`}>{(row.after ?? row.before)!.opportunityName}</Link><span className="block text-slate-600">{movementLabels[row.primary]} · Pipeline {money(row.impact)}</span></li>)}</ul>{!result.groups[key].length && <p className="mt-2 text-sm text-slate-500">No movements in this group for the selected snapshots.</p>}</section>)}</div><p className="mt-2 text-xs text-slate-500">Up to five Opportunities per group. Groups may overlap and are not added together.</p></section>
      <section id="movement-table" className="panel min-w-0 overflow-x-auto" aria-label="Deal movement">
        <h2 className="p-4 text-lg font-semibold">Deal movement · {result.rows.length} Opportunities</h2>
        <table className="w-full min-w-[1100px] text-sm"><thead><tr>{['Opportunity / Account', 'Owner', 'Previous Value', 'Current Value', 'Primary Movement', 'Pipeline Impact', 'Forecast Impact', 'Details'].map(label => <th key={label} className="p-3 text-left">{label}</th>)}</tr></thead><tbody>{result.rows.slice((page - 1) * 50, page * 50).map(row => {
          const captured = (row.after ?? row.before)!;
          const accounts = snapshotAccounts(captured.accounts ?? null);
          const endpointValue = (endpoint: typeof row.before) => endpoint ? formatPlanCurrency(endpoint.amount, endpoint.currencyCode) : '—';
          return <tr key={row.opportunityId} className="border-t align-top" data-opportunity-id={row.opportunityId}><td className="p-3"><Link href={`/opportunities/${row.opportunityId}`} className="text-orange-800 underline">{captured.opportunityName}</Link><span className="mt-1 block text-xs text-slate-500">{accounts.map(account => account.name).join(', ') || 'No captured Account'}</span></td><td className="p-3">{row.before?.ownerName ?? '—'}{row.before?.ownerId !== row.after?.ownerId && <span className="block">→ {row.after?.ownerName ?? '—'}</span>}</td><td className="p-3 whitespace-nowrap">{endpointValue(row.before)}</td><td className="p-3 whitespace-nowrap">{endpointValue(row.after)}</td><td className="p-3">{movementLabels[row.primary]}</td><td className="p-3 whitespace-nowrap" data-pipeline-impact={row.impact}>{money(row.impact)}</td><td className="p-3">{row.forecast.filter(item => item.impact !== '0.00').map(item => <span className="block whitespace-nowrap" key={item.category}>{categoryName(item.category)}: {money(item.impact)}</span>)}{row.forecast.every(item => item.impact === '0.00') && 'No change'}</td><td className="p-3"><details><summary className="cursor-pointer text-orange-800">All changes</summary><dl className="mt-2 min-w-64 space-y-2"><div><dt className="font-medium">Expected close (previous → current)</dt><dd>{date(row.before?.expectedCloseDate)} → {date(row.after?.expectedCloseDate)}</dd></div><div><dt className="font-medium">Forecast category (previous → current)</dt><dd>{row.before?.forecastCategory ? categoryName(row.before.forecastCategory) : '—'} → {row.after?.forecastCategory ? categoryName(row.after.forecastCategory) : '—'}</dd></div><div><dt className="font-medium">Stage (previous → current)</dt><dd>{row.before?.stageName ?? '—'} → {row.after?.stageName ?? '—'}</dd></div><div><dt className="font-medium">Reconciliation allocation</dt><dd>{row.bucket ? financialLabels[row.bucket] : 'No financial movement'}: {money(row.impact)}</dd></div></dl><ul className="mt-2 list-inside list-disc space-y-1">{row.changes.map((change, i) => <li key={i}>{movementLabels[change.type]}: {change.detail}</li>)}</ul>{row.primary === 'UNCHANGED' && <p>No captured changes.</p>}</details></td></tr>;
        })}</tbody></table>
        {!result.rows.length && <p className="p-4 text-sm text-slate-500">No matching Opportunities for the selected filters in either snapshot.</p>}
      </section>
      <nav className="mt-3 flex flex-wrap items-center gap-4 text-sm" aria-label="Movement pages">{page > 1 && <Link className="text-orange-800 underline" href={href(page - 1)}>Previous page</Link>}<span>Page {page} of {pageCount} · 50 deals per page</span>{page < pageCount && <Link className="text-orange-800 underline" href={href(page + 1)}>Next page</Link>}</nav>
      <p className="mt-4 text-xs text-slate-500">Values reflect the selected snapshots. Current Actual Close Dates and Outcome Reasons do not change this comparison. See Help for movement definitions.</p>
    </>}
  </Content>;
}
