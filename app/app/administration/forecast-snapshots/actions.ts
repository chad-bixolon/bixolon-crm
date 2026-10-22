'use server';
import { revalidatePath } from 'next/cache';
import type { SalesQuarter } from '@prisma/client';
import { requireMutation } from '@/lib/current-user';
import { prisma } from '@/lib/prisma';
import { captureForecastSnapshot, previewForecastSnapshot, summarizeForecastRows } from '@/lib/forecast-snapshots';
import { signForecastPreview, verifyForecastPreview } from '@/lib/forecast-snapshot-preview';
function safeMessage(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  return /^(Choose |This Opportunity Snapshot|Source snapshot|Explicit confirmation|Preview expired|Invalid forecast preview)/.test(message)
    ? message : 'Could not capture the Forecast Snapshot. No partial snapshot was saved. Try again.';
}
export async function previewForecastAction(input: { sourceRunId: number; year: number; quarter: SalesQuarter }) {
  const actor = await requireMutation('configuration.manage');
  try {
    const result = await previewForecastSnapshot(prisma, actor, input);
    const currencies = [...new Set(result.rows.map(row => row.currencyCode))].sort();
    return { preview: {
      sourceRunId: result.source.id, snapshotAt: result.source.snapshotAt.toISOString(), year: input.year, quarter: input.quarter,
      opportunityCount: result.opportunityCount, salespersonCount: result.salespersonCount,
      totals: currencies.map(currencyCode => ({ currencyCode, ...Object.fromEntries(Object.entries(summarizeForecastRows(result.rows.filter(row => row.currencyCode === currencyCode))).map(([key, value]) => [key, value.toFixed(2)])) })) as { currencyCode: string; pipeline: string; bestCase: string; commit: string; closedWon: string; opportunityCount: string }[],
      token: signForecastPreview(result.preview, actor.id, process.env.AUTH_SECRET ?? ''),
    } };
  } catch (error) { return { error: safeMessage(error) }; }
}
export async function confirmForecastAction(token: string, confirmed: boolean) {
  const actor = await requireMutation('configuration.manage');
  try {
    const run = await captureForecastSnapshot(prisma, actor, verifyForecastPreview(token, actor.id, process.env.AUTH_SECRET ?? ''), confirmed);
    revalidatePath('/administration/forecast-snapshots'); revalidatePath('/reports/forecast-snapshots');
    return { success: `Created Forecast Snapshot #${run.id} using Opportunity Snapshot #${run.sourceRunId}: ${run.opportunityCount} Opportunities for ${run.year} ${run.quarter}.`, runId: run.id };
  } catch (error) { return { error: safeMessage(error) }; }
}
