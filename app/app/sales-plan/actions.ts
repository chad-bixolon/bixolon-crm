'use server';
import { assertModuleEnabled } from '@/lib/module-availability';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { SalesQuarter } from '@prisma/client';
import { requireMutation } from '@/lib/current-user';
import { prisma } from '@/lib/prisma';
import { saveLineAllocation } from '@/lib/sales-plan';
import { captureActionError } from '../../lib/request-observability';
export async function allocateAction(form:FormData){
  await assertModuleEnabled('SALES_PLANS');
  const actor=await requireMutation('sales-plan.allocate');
  const lineId=Number(form.get('lineId'));let message='';
  const quarters=Object.fromEntries(['Q1','Q2','Q3','Q4'].map(q=>[q,{units:String(form.get(`${q}Units`)??''),revenue:String(form.get(`${q}Revenue`)??'')}])) as Record<SalesQuarter,{units:string;revenue:string}>;
  try{await saveLineAllocation(prisma,actor,{lineId,quarters});}catch(e){message=(await captureActionError(e, 'sales-plan.allocate', { userId: actor.id, entityType: 'SalesPlanLine', entityId: lineId })) ?? (e instanceof Error?e.message:'Allocation failed.');}
  if(message)return {error:message};
  revalidatePath('/sales-plan');redirect('/sales-plan?saved=1');
}
