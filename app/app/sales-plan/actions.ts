'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { SalesQuarter } from '@prisma/client';
import { requireMutation } from '@/lib/current-user';
import { prisma } from '@/lib/prisma';
import { saveLineAllocation } from '@/lib/sales-plan';
export async function allocateAction(form:FormData){
  const actor=await requireMutation('sales-plan.allocate');
  const lineId=Number(form.get('lineId'));let message='';
  const quarters=Object.fromEntries(['Q1','Q2','Q3','Q4'].map(q=>[q,{units:String(form.get(`${q}Units`)??''),revenue:String(form.get(`${q}Revenue`)??'')}])) as Record<SalesQuarter,{units:string;revenue:string}>;
  try{await saveLineAllocation(prisma,actor,{lineId,quarters});}catch(e){message=e instanceof Error?e.message:'Allocation failed.';}
  revalidatePath('/sales-plan');redirect(`/sales-plan?${message?`error=${encodeURIComponent(message)}`:'saved=1'}`);
}
