'use client';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { formatCurrency } from '@/lib/display-format';
import type { PipelineReportResult, AccountActivityReportResult, ReportConfiguration } from '@/lib/reporting';

const metricLabel: Record<string, string> = { pipeline: 'Pipeline', weightedPipeline: 'Weighted Pipeline', opportunityCount: 'Opportunities', averageOpportunityValue: 'Average Opportunity Value' };
const columnLabel: Record<string, string> = { opportunity: 'Opportunity', account: 'Account', owner: 'Owner', stage: 'Stage', closeDate: 'Close Date', value: 'Value', weightedValue: 'Weighted Value', currency: 'Currency' };
const cellSpacing = 'px-2 py-1.5';
const columnClass: Record<string, string> = {
  opportunity: 'max-w-48', account: 'max-w-44', owner: 'max-w-28', stage: 'max-w-28',
  closeDate: 'whitespace-nowrap', value: 'whitespace-nowrap text-right tabular-nums',
  weightedValue: 'whitespace-nowrap text-right tabular-nums', currency: 'whitespace-nowrap',
};
const accountColumnClass: Record<string, string> = {
  account: 'max-w-48', owner: 'max-w-28', industry: 'max-w-28', territory: 'max-w-28', businessRoles: 'max-w-36',
  strategicAccount: 'whitespace-nowrap', lastActivity: 'whitespace-nowrap', daysSinceLastActivity: 'tabular-nums',
  activityStatus: 'whitespace-nowrap', latestActivityType: 'max-w-36', latestActivityBy: 'max-w-28', activityCount: 'tabular-nums',
};

function TruncatedText({ value, maxWidth = 'max-w-48', children }: { value: string; maxWidth?: string; children?: ReactNode }) {
  return <span className={`block truncate focus-within:outline-2 focus-within:outline-orange-600 ${maxWidth}`} title={value}>{children ?? value}</span>;
}

function ResultTableScroll({ label, children }: { label: string; children: ReactNode }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const [scroll, setScroll] = useState({ max: 0, position: 0, thumb: 32 });
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const update = () => {
      const max = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
      const thumb = Math.max(32, Math.round(Math.max(viewport.clientWidth - 32, 0) * viewport.clientWidth / Math.max(viewport.scrollWidth, 1)));
      setScroll({ max, position: Math.min(viewport.scrollLeft, max), thumb });
    };
    const observer = new ResizeObserver(update);
    observer.observe(viewport);
    if (viewport.firstElementChild) observer.observe(viewport.firstElementChild);
    update();
    return () => observer.disconnect();
  }, [children]);
  return <>
    <div id={id} ref={viewportRef} role="region" aria-label={`${label} table`} tabIndex={0} onScroll={event => {
      const position = event.currentTarget.scrollLeft;
      setScroll(current => ({ ...current, position }));
    }} className="report-table-viewport max-w-full overflow-x-auto overscroll-x-contain focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-orange-600">
      {children}
    </div>
    {scroll.max > 1 && <div className="report-scroll-control"><input className="report-scroll-range" type="range" min={0} max={scroll.max} step={1} value={scroll.position} aria-label={`Scroll ${label} horizontally`} aria-controls={id} style={{ '--report-thumb-width': `${scroll.thumb}px` } as CSSProperties} onChange={event => { if (viewportRef.current) viewportRef.current.scrollLeft = Number(event.target.value); }}/></div>}
  </>;
}

function AccountResults({result,config,groupKey}:{result:AccountActivityReportResult;config:ReportConfiguration;groupKey?:string}) {
  const pathname=usePathname(),searchParams=useSearchParams();
  const groupHref=(key?:string)=>{const query=new URLSearchParams(searchParams.toString());if(key)query.set('group',key);else query.delete('group');return `${pathname}?${query}`;};
  const detail=groupKey?result.rows.filter(row=>row.groupKeys.includes(groupKey)):result.rows;
  const labels:Record<string,string>={accountCount:'Account Count',noActivityCount:'Accounts With No Activity',staleAccountCount:`Stale Accounts (${result.staleThresholdDays}+ days)`,activityCount:'Activity Count',averageDaysSinceLastActivity:'Average Days Since Last Activity'};
  const display=(metric:string,value:number|null)=>value===null?'—':value;
  const values=(item:typeof result.summary,metric:string)=>item[metric as keyof typeof item];
  const cells=(row:typeof result.rows[number],column:string)=>column==='account'?<TruncatedText value={row.account} maxWidth="max-w-48"><Link className="text-orange-800 underline" href={`/accounts/${row.id}`}>{row.account}</Link></TruncatedText>:column==='strategicAccount'?(row.strategicAccount?'Yes':'No'):column==='lastActivity'?(row.lastActivity??'No activity'):column==='daysSinceLastActivity'?(row.daysSinceLastActivity??'—'):<TruncatedText value={String(row[column as keyof typeof row]??'—')} maxWidth={accountColumnClass[column]??'max-w-32'}/>;
  return <div className="mt-4 min-w-0 max-w-full space-y-4"><p className="text-sm text-slate-600">{result.semanticNote} Never contacted Accounts have no Activity date. Oldest first places them first; newest first places them last.</p>
  <section><h2 className="mb-2 text-lg font-semibold">Summary</h2><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">{config.metrics.map(metric=><div className="panel p-3" key={metric}><p className="text-xs uppercase text-slate-500">{labels[metric]}</p><p className="mt-1 text-xl font-semibold tabular-nums">{display(metric,values(result.summary,metric))}</p></div>)}</div></section>
  {!!result.groups.length&&<section className="panel min-w-0 max-w-full"><h2 className="px-4 py-3 text-lg font-semibold">Grouped results</h2><ResultTableScroll label="Grouped results"><table className="w-full min-w-max text-sm"><thead className="bg-slate-50"><tr><th scope="col" className={`${cellSpacing} text-left`}>Group</th>{config.metrics.map(metric=><th scope="col" className={`${cellSpacing} text-right`} key={metric}>{labels[metric]}</th>)}</tr></thead><tbody className="divide-y">{result.groups.map(group=><tr key={group.key}><td className={cellSpacing}><Link className="text-orange-800 underline" href={groupHref(group.key)}>{group.label}</Link></td>{config.metrics.map(metric=><td className={`${cellSpacing} text-right tabular-nums`} key={metric}>{display(metric,values(group.metrics,metric))}</td>)}</tr>)}</tbody></table></ResultTableScroll></section>}
  <section className="panel min-w-0 max-w-full"><div className="flex items-center justify-between px-4 py-3"><h2 className="text-lg font-semibold">{groupKey?'Drill-down':'Details'} ({detail.length})</h2>{groupKey&&<Link className="btn-secondary" href={groupHref()}>Clear drill-down</Link>}</div><ResultTableScroll label="Account details"><table className="w-full min-w-max text-sm"><thead className="bg-slate-50"><tr>{config.columns.map(column=><th scope="col" className={`${cellSpacing} text-left`} key={column}>{({account:'Account',owner:'Owner',industry:'Industry',territory:'Territory',businessRoles:'Business Roles',strategicAccount:'Strategic Account',lastActivity:'Last Activity',daysSinceLastActivity:'Days Since Last Activity',activityStatus:'Activity Status',latestActivityType:'Latest Activity Type',latestActivityBy:'Latest Activity By',activityCount:'Activity Count'} as Record<string,string>)[column]}</th>)}</tr></thead><tbody className="divide-y">{detail.map(row=><tr key={row.id}>{config.columns.map(column=><td className={`${cellSpacing} ${accountColumnClass[column]}`} key={column}>{cells(row,column)}</td>)}</tr>)}</tbody></table></ResultTableScroll>{!detail.length&&<p className="p-4 text-sm text-slate-500">No Accounts match this report.</p>}</section></div>;
}

export function ReportResults({ result, config, groupKey }: { result: PipelineReportResult|AccountActivityReportResult; config: ReportConfiguration; groupKey?: string }) {
  return result.reportType==='ACCOUNT_ACTIVITY'?<AccountResults result={result} config={config} groupKey={groupKey}/>:<PipelineResults result={result} config={config} groupKey={groupKey}/>;
}
function PipelineResults({ result, config, groupKey }: { result: PipelineReportResult; config: ReportConfiguration; groupKey?: string }) {
  const pathname = usePathname(), searchParams = useSearchParams();
  const groupHref = (key?: string) => { const query = new URLSearchParams(searchParams.toString()); if (key) query.set('group', key); else query.delete('group'); return `${pathname}?${query}`; };
  const detail = groupKey ? result.rows.filter(row => row.groupKeys.includes(groupKey)) : result.rows;
  return <div className="mt-4 min-w-0 max-w-full space-y-4">
    <p className="text-sm text-slate-600">{result.semanticNote}</p>
    <section><div className="mb-2 flex flex-wrap items-baseline justify-between gap-2"><h2 className="text-lg font-semibold">Summary</h2>{result.currencies.length > 1 && <p className="text-xs text-slate-600">Totals are shown separately by currency.</p>}</div><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{result.summary.flatMap(summary => config.metrics.map(metric => <div className="panel min-w-0 p-3" key={`${summary.currency}-${metric}`}><p className="text-xs uppercase tracking-wide text-slate-500">{metricLabel[metric]}{metric === 'opportunityCount' ? '' : ` · ${summary.currency}`}</p><p className="mt-1 break-words text-xl font-semibold tabular-nums sm:text-2xl">{metric === 'opportunityCount' ? summary.opportunityCount : formatCurrency(Number(summary[metric as 'pipeline'|'weightedPipeline'|'averageOpportunityValue']), summary.currency, result.currencies.length > 1)}</p></div>))}</div></section>
    {!!result.groups.length && <section className="panel min-w-0 max-w-full"><h2 className="px-4 py-3 text-lg font-semibold">Grouped results</h2><ResultTableScroll label="Grouped results"><table className="w-full min-w-max text-sm"><thead className="bg-slate-50"><tr><th scope="col" className={`${cellSpacing} max-w-52 text-left`}>Group</th><th scope="col" className={`${cellSpacing} whitespace-nowrap text-left`}>Currency</th>{config.metrics.map(metric => <th scope="col" className={`${cellSpacing} whitespace-nowrap text-right`} key={metric}>{metricLabel[metric]}</th>)}</tr></thead><tbody className="divide-y">{result.groups.flatMap(group => group.metrics.map((summary, index) => <tr key={`${group.key}-${summary.currency}`}><td className={`${cellSpacing} max-w-52`}>{index === 0 ? <TruncatedText value={group.label} maxWidth="max-w-48"><Link className="text-orange-800 underline focus-visible:outline-2 focus-visible:outline-orange-600" href={groupHref(group.key)}>{group.label}</Link></TruncatedText> : ''}</td><td className={`${cellSpacing} whitespace-nowrap`}>{summary.currency}</td>{config.metrics.map(metric => <td className={`${cellSpacing} whitespace-nowrap text-right tabular-nums`} key={metric}>{metric === 'opportunityCount' ? summary.opportunityCount : formatCurrency(Number(summary[metric as 'pipeline'|'weightedPipeline'|'averageOpportunityValue']), summary.currency, true)}</td>)}</tr>))}</tbody></table></ResultTableScroll></section>}
    <section className="panel min-w-0 max-w-full"><div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"><h2 className="text-lg font-semibold">{groupKey ? 'Drill-down' : 'Details'} ({detail.length})</h2>{groupKey && <Link className="btn-secondary" href={groupHref()}>Clear drill-down</Link>}</div><ResultTableScroll label="Details"><table className="w-full min-w-max text-sm"><thead className="bg-slate-50"><tr>{config.columns.map(column => <th scope="col" className={`${cellSpacing} ${columnClass[column]} ${['value', 'weightedValue'].includes(column) ? '' : 'text-left'}`} key={column}>{columnLabel[column]}</th>)}</tr></thead><tbody className="divide-y">{detail.map(row => <tr key={row.id}>{config.columns.map(column => <td className={`${cellSpacing} ${columnClass[column]}`} key={column}>{column === 'opportunity' ? <TruncatedText value={row.opportunity} maxWidth="max-w-48"><Link className="text-orange-800 underline focus-visible:outline-2 focus-visible:outline-orange-600" href={`/opportunities/${row.id}`}>{row.opportunity}</Link></TruncatedText> : column === 'account' ? <TruncatedText value={row.accounts} /> : column === 'owner' ? <TruncatedText value={row.owner} maxWidth="max-w-28" /> : column === 'stage' ? <TruncatedText value={row.stage} maxWidth="max-w-28" /> : column === 'closeDate' ? row.closeDate ?? '—' : column === 'value' ? formatCurrency(Number(row.value), row.currency) : column === 'weightedValue' ? `${formatCurrency(Number(row.weightedValue), row.currency)} (${row.probability}%)` : row.currency}</td>)}</tr>)}</tbody></table></ResultTableScroll>{!detail.length && <p className="p-4 text-sm text-slate-500">No Opportunities match this report.</p>}</section>
  </div>;
}
