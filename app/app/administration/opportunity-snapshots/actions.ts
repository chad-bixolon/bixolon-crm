'use server';
import { revalidatePath } from 'next/cache';
import { requireMutation } from '@/lib/current-user';
import { prisma } from '@/lib/prisma';
import { assertSnapshotAdmin, captureOpportunitySnapshot, previewOpportunitySnapshot } from '@/lib/opportunity-snapshots';
import { signSnapshotPreview, verifySnapshotPreview } from '@/lib/opportunity-snapshot-preview';

function safeMessage(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  return /^(This week already|Snapshot exceeds|Explicit confirmation|Preview expired|Snapshot week changed|Opportunity data changed|Invalid snapshot preview)/.test(message)
    ? message : 'Could not capture the snapshot. No partial snapshot was saved. Try again.';
}
export async function previewSnapshotAction(forecastReady = false) {
  const actor = await requireMutation('configuration.manage');
  assertSnapshotAdmin(actor);
  try {
    const preview = await previewOpportunitySnapshot(prisma, actor, forecastReady);
    return { preview: { preparedAt: preview.preparedAt, week: preview.week, count: preview.count, forecastReady: preview.forecastReady, token: signSnapshotPreview(preview, actor.id, process.env.AUTH_SECRET ?? '') } };
  } catch (error) { return { error: safeMessage(error) }; }
}
export async function confirmSnapshotAction(token: string, confirmed: boolean) {
  const actor = await requireMutation('configuration.manage');
  assertSnapshotAdmin(actor);
  try {
    const preview = verifySnapshotPreview(token, actor.id, process.env.AUTH_SECRET ?? '');
    const run = await captureOpportunitySnapshot(prisma, actor, preview, confirmed);
    revalidatePath('/administration/opportunity-snapshots');
    revalidatePath('/reports/opportunity-snapshots');
    return { success: `Captured ${run.opportunityCount} Opportunities at ${run.snapshotAt.toISOString()} in snapshot #${run.id}.`, runId: run.id };
  } catch (error) { return { error: safeMessage(error) }; }
}
