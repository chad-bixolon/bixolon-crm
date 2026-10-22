'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { SalesQuarter } from '@prisma/client';
import { requireMutation } from '@/lib/current-user';
import { prisma } from '@/lib/prisma';
import { archiveHistoryBatch, captureForecastWeek, previewHistoryArchive, restoreHistoryBatch } from '@/lib/opportunity-history';
import { formatCalendarDate } from '@/lib/display-format';
import { captureFeedback, existingCaptureFeedback } from '@/lib/history-admin-display';

export async function captureSnapshotAction(form: FormData) {
  const actor = await requireMutation('configuration.manage');
  if (actor.role !== 'ADMIN') throw new Error('Access denied');
  const year = Number(form.get('year')), quarter = String(form.get('quarter')) as SalesQuarter, currencyCode = String(form.get('currencyCode'));
  let result;
  try {
    result = await captureForecastWeek(prisma, actor, { year, quarter, currencyCode });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    return { error: message === 'Choose a valid year and quarter.' || message === 'Invalid currency' || message === 'Choose a currency.'
      ? message : 'Could not capture snapshot. Try again.' };
  }
  const week = formatCalendarDate(result.snapshotWeek);
  return { success: result.created ? captureFeedback(result.created, week) : existingCaptureFeedback(week) };
}

export async function restoreHistoryAction(form: FormData) {
  const actor = await requireMutation('configuration.manage');
  if (actor.role !== 'ADMIN') throw new Error('Access denied');
  await restoreHistoryBatch(prisma, actor, String(form.get('batchId') ?? ''));
  revalidatePath('/administration/history');
  revalidatePath('/reports/forecast-movement');
  redirect('/administration/history?restore=complete');
}

export async function archiveHistoryAction(form: FormData) {
  const actor = await requireMutation('configuration.manage');
  if (actor.role !== 'ADMIN') throw new Error('Access denied');
  const preview = await previewHistoryArchive(prisma, actor);
  if (String(form.get('cutoff')) !== preview.cutoff.toISOString() || String(form.get('events')) !== String(preview.events) || String(form.get('snapshots')) !== String(preview.snapshots)) throw new Error('Archive preview changed. Refresh and review again.');
  await archiveHistoryBatch(prisma, actor, preview.cutoff);
  revalidatePath('/administration/history');
}
