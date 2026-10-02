'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireMutation } from '@/lib/current-user';
import { prisma } from '@/lib/prisma';
import { confirmTargetSync } from '@/lib/sales-target-sync';

export async function confirmSyncAction(form: FormData) {
  const actor=await requireMutation('sales-plan.manage');
  const userId=Number(form.get('userId')),year=Number(form.get('year')),currencyCode=String(form.get('currencyCode')??'');
  const params=new URLSearchParams({userId:String(userId),year:String(year),currencyCode});
  try {
    await confirmTargetSync(prisma,actor,{userId,year,currencyCode,planId:Number(form.get('planId')),snapshot:String(form.get('snapshot')??'')});
    revalidatePath('/sales-plan');revalidatePath('/reports/sales-plan');
    params.set('saved','1');
  } catch(e) {params.set('error',e instanceof Error?e.message:'Target sync failed.');}
  redirect(`/sales-plan/sync?${params}`);
}
