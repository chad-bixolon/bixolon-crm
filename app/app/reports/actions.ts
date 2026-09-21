'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { currentUser } from '@/lib/current-user';
import { archiveReportDefinition, duplicateReportDefinition, saveReportDefinition } from '@/lib/saved-reports';

function id(value: FormDataEntryValue | null){const parsed=Number(value);return Number.isSafeInteger(parsed)&&parsed>0?parsed:undefined;}
export async function saveReportAction(form: FormData){const actor=await currentUser();const reportId=await saveReportDefinition(prisma,actor,{name:String(form.get('name')??''),description:String(form.get('description')??'')||null,reportType:String(form.get('reportType')??''),visibility:String(form.get('visibility')??''),configuration:JSON.parse(String(form.get('configuration')??'null'))},id(form.get('reportId')));revalidatePath('/reports');redirect(`/reports/${reportId}`);}
export async function duplicateReportAction(form: FormData){const actor=await currentUser();const reportId=await duplicateReportDefinition(prisma,actor,id(form.get('reportId'))??0);revalidatePath('/reports');redirect(`/reports/${reportId}`);}
export async function archiveReportAction(form: FormData){const actor=await currentUser();await archiveReportDefinition(prisma,actor,id(form.get('reportId'))??0);revalidatePath('/reports');redirect('/reports');}
