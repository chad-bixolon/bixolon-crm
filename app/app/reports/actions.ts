'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { currentUser } from '@/lib/current-user';
import { archiveReportDefinition, duplicateReportDefinition, restoreReportDefinition, saveReportDefinition } from '@/lib/saved-reports';
import { getModuleAvailability, reportTypeAvailable } from '@/lib/module-availability';
import { requireEditToken, isRecordChanged, recordChangedMessage } from '@/lib/stale-edit';

function id(value: FormDataEntryValue | null){const parsed=Number(value);return Number.isSafeInteger(parsed)&&parsed>0?parsed:undefined;}
async function requireReportModule(form: FormData) {
  const existingId=id(form.get('reportId'));
  const submittedType=String(form.get('reportType')??'');
  const type=existingId?(await prisma.reportDefinition.findUnique({where:{id:existingId},select:{reportType:true}}))?.reportType:submittedType;
  const availability=await getModuleAvailability();
  if(!type||!reportTypeAvailable(type,availability)||form.has('reportType')&&!reportTypeAvailable(submittedType,availability))throw new Error('Report unavailable.');
}
export async function saveReportAction(form: FormData){const actor=await currentUser();await requireReportModule(form);let reportId:number;try{const existingId=id(form.get('reportId'));reportId=await saveReportDefinition(prisma,actor,{name:String(form.get('name')??''),description:String(form.get('description')??'')||null,reportType:String(form.get('reportType')??''),visibility:String(form.get('visibility')??''),configuration:JSON.parse(String(form.get('configuration')??'null'))},existingId,existingId?requireEditToken(form):undefined);}catch(error){if(isRecordChanged(error))return{error:recordChangedMessage};throw error;}revalidatePath('/reports');redirect(`/reports/${reportId}`);}
export async function duplicateReportAction(form: FormData){const actor=await currentUser();await requireReportModule(form);const reportId=await duplicateReportDefinition(prisma,actor,id(form.get('reportId'))??0);revalidatePath('/reports');redirect(`/reports/${reportId}`);}
export async function archiveReportAction(form: FormData){const actor=await currentUser();await requireReportModule(form);await archiveReportDefinition(prisma,actor,id(form.get('reportId'))??0);revalidatePath('/reports');redirect('/reports');}
export async function restoreReportAction(form: FormData){const actor=await currentUser();await requireReportModule(form);await restoreReportDefinition(prisma,actor,id(form.get('reportId'))??0);revalidatePath('/reports');redirect('/reports');}
