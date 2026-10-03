'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { SalesQuarter } from '@prisma/client';
import { requireMutation } from '@/lib/current-user';
import { prisma } from '@/lib/prisma';
import { archiveHistoryBatch, captureForecastWeek, previewHistoryArchive, restoreHistoryBatch } from '@/lib/opportunity-history';

export async function captureSnapshotAction(form: FormData) {
  const actor = await requireMutation('users.manage');
  if (actor.role !== 'ADMIN') throw new Error('Access denied');
  const year = Number(form.get('year')), quarter = String(form.get('quarter')) as SalesQuarter, currencyCode = String(form.get('currencyCode'));
  const result = await captureForecastWeek(prisma, actor, { year, quarter, currencyCode });
  revalidatePath('/administration/history');
  revalidatePath('/reports/forecast-movement');
  redirect(`/administration/history?capture=${result.created ? 'created' : 'existing'}&count=${result.created}&week=${result.snapshotWeek.toISOString().slice(0,10)}`);
}

export async function restoreHistoryAction(form: FormData) {
  const actor = await requireMutation('users.manage');
  if (actor.role !== 'ADMIN') throw new Error('Access denied');
  await restoreHistoryBatch(prisma, actor, String(form.get('batchId') ?? ''));
  revalidatePath('/administration/history');
  revalidatePath('/reports/forecast-movement');
  redirect('/administration/history?restore=complete');
}

export async function archiveHistoryAction(form: FormData) {
  const actor = await requireMutation('users.manage');
  if (actor.role !== 'ADMIN') throw new Error('Access denied');
  const preview = await previewHistoryArchive(prisma, actor);
  if (String(form.get('cutoff')) !== preview.cutoff.toISOString() || String(form.get('events')) !== String(preview.events) || String(form.get('snapshots')) !== String(preview.snapshots)) throw new Error('Archive preview changed. Refresh and review again.');
  await archiveHistoryBatch(prisma, actor, preview.cutoff);
  revalidatePath('/administration/history');
}
