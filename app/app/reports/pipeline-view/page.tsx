import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Content, PageHeader } from '@/components/shell';
import { ReportResults } from '@/components/report-results';
import { currentUser } from '@/lib/current-user';
import { prisma } from '@/lib/prisma';
import { pipelineConfigFromParams } from '@/lib/report-builder';
import { canRunReportType, executePipelineReport } from '@/lib/reporting';

export const dynamic = 'force-dynamic';
type Params = Record<string, string | string[] | undefined>;
export default async function PipelineViewPage({ searchParams }: { searchParams: Promise<Params> }) {
  const actor = await currentUser();
  if (!canRunReportType(actor, 'PIPELINE')) notFound();
  const params = await searchParams;
  const config = pipelineConfigFromParams(params);
  const result = await executePipelineReport(prisma, actor, config);
  return <Content><PageHeader eyebrow="Reports" title="Pipeline Report" description="Current Opportunities in your permitted view." action={<Link className="btn-secondary" href="/reports">Reports</Link>}/><ReportResults result={result} config={config} groupKey={typeof params.group === 'string' ? params.group : undefined}/></Content>;
}
