import type { analyzeHistory } from '@/lib/pipeline-movement-history';
import { formatPlanCurrency } from '@/lib/display-format';

type Point = ReturnType<typeof analyzeHistory>['points'][number];
const series = [{ key: 'pipeline', label: 'Pipeline', color: 'var(--chart-pipeline)' }, { key: 'bestCase', label: 'Best Case', color: 'var(--chart-best-case)' }, { key: 'commit', label: 'Commit', color: 'var(--chart-commit)' }, { key: 'closedWon', label: 'Closed Won', color: 'var(--chart-closed-won)' }] as const;
export function PipelineHistoryChart({ points, currencyCode }: { points: Point[]; currencyCode: string }) {
  if (!points.length) return null;
  if (points.length === 1) return <figure className="rounded-lg bg-slate-50 p-4" aria-label="Pipeline trend chart"><figcaption className="font-semibold">Pipeline Trend</figcaption><p className="mt-2 text-sm text-slate-600" role="status">One weekly snapshot is available. More weekly history is needed to show a trend. Values are listed below.</p></figure>;
  const max = Math.max(1, ...points.flatMap(p => series.map(s => Number(p[s.key] ?? 0))));
  const first = points[0].at.getTime(), span = Math.max(1, points.at(-1)!.at.getTime() - first);
  const x = (p: Point) => 100 + (p.at.getTime() - first) / span * 670;
  const y = (value: string) => 245 - Number(value) / max * 210;
  return <figure className="min-w-0" aria-label="Pipeline trend chart">
    <figcaption className="mb-3 font-semibold">Pipeline Trend <span className="ml-2 text-sm font-normal text-slate-600">{currencyCode}</span></figcaption>
    {points.length === 2 && <p className="mb-3 text-sm text-slate-600">Two snapshots are available; the chart shows the change between them.</p>}
    <div className="overflow-x-auto"><svg viewBox="0 0 800 300" className="w-full min-w-[580px]" role="img" aria-label={`Pipeline, Best Case, Commit and Closed Won in ${currencyCode}. Exact values are in the table below.`}>
      {[0, 0.5, 1].map(fraction => <g key={fraction}><line x1="100" x2="775" y1={245 - fraction * 210} y2={245 - fraction * 210} stroke="var(--border-color)"/><text x="94" y={249 - fraction * 210} textAnchor="end" fontSize="13" fill="var(--text-secondary)">{new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(max * fraction)}</text></g>)}
      {series.map(s => <g key={s.key}>{points.map((p, i) => <g key={p.id}>{i > 0 && !p.gap && p[s.key] !== null && points[i - 1][s.key] !== null && <line x1={x(points[i - 1])} y1={y(points[i - 1][s.key]!)} x2={x(p)} y2={y(p[s.key]!)} stroke={s.color} strokeWidth="2.5"/>}{p[s.key] !== null && <circle cx={x(p)} cy={y(p[s.key]!)} r="4" fill={s.color}><title>{`${p.at.toISOString().slice(0, 10)} · ${s.label}: ${formatPlanCurrency(p[s.key]!, currencyCode)}`}</title></circle>}</g>)}</g>)}
      {points.filter((_, i) => i === 0 || i === points.length - 1 || points.length <= 8 || i % 2 === 0).map(p => <text key={p.id} x={x(p)} y="274" textAnchor="middle" fontSize="13" fill="var(--text-secondary)">{p.at.toISOString().slice(5, 10)}</text>)}
    </svg></div>
    <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm" aria-label="Chart legend">{series.map(s => <span key={s.key} className="inline-flex items-center gap-2"><span className="inline-block h-3 w-3 rounded-full" style={{ background: s.color }}/>{s.label}</span>)}</div>
    <p className="mt-2 text-xs text-slate-600">Pipeline includes Best Case and Commit. Gaps mark missing weeks; unavailable values are not zero. Scroll to see all weeks on smaller screens.</p>
  </figure>;
}
