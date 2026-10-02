'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { SalesQuarter } from '@prisma/client';
import { requireMutation } from '@/lib/current-user';
import { prisma } from '@/lib/prisma';
import { saveAllocation } from '@/lib/sales-plan';
export async function allocateAction(form:FormData){const actor=await requireMutation('sales-plan.allocate');const lineId=Number(form.get('lineId')),quarter=String(form.get('quarter')) as SalesQuarter;let message='';try{await saveAllocation(prisma,actor,{lineId,quarter,units:String(form.get('units')??''),revenue:String(form.get('revenue')??'')});}catch(e){message=e instanceof Error?e.message:'Allocation failed.';}revalidatePath('/sales-plan');redirect(`/sales-plan?${message?`error=${encodeURIComponent(message)}`:'saved=1'}`);}
