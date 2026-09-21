import type { Prisma, PrismaClient } from '@prisma/client';
import type { Actor } from './authorization';
import { canCreateReport, canEditReportDefinition, canRunReportType, canShareReport, canViewReportDefinition, reportTypes, reportVisibilities, validateReportConfiguration } from './reporting';

export type SavedReportInput = { name: string; description: string | null; reportType: string; visibility: string; configuration: unknown };
export function validateSavedReportInput(actor: Actor, input: SavedReportInput) {
  if (!canCreateReport(actor)) throw new Error('This role cannot create or edit reports.');
  const name=input.name.trim(); if(!name || name.length>120) throw new Error('Report name is required and must be 120 characters or fewer.');
  const description=input.description?.trim()||null; if(description&&description.length>1000) throw new Error('Report description must be 1,000 characters or fewer.');
  if(!reportTypes.includes(input.reportType as never)) throw new Error('Unknown report type.');
  if(!canRunReportType(actor,input.reportType)) throw new Error('This report type is not available to this role.');
  if(!reportVisibilities.includes(input.visibility as never)) throw new Error('Unknown report visibility.');
  if(input.visibility==='SHARED'&&!canShareReport(actor)) throw new Error('Only Sales Managers and Administrators can share reports.');
  return {name,description,reportType:input.reportType as typeof reportTypes[number],visibility:input.visibility as typeof reportVisibilities[number],configuration:validateReportConfiguration(input.reportType,input.configuration)};
}
export async function saveReportDefinition(client: PrismaClient, actor: Actor, input: SavedReportInput, id?: number) {
  const value=validateSavedReportInput(actor,input);
  if(id){const existing=await client.reportDefinition.findUnique({where:{id}}); if(!existing||existing.archivedAt)throw new Error('Report not found or archived.'); if(!canEditReportDefinition(actor,existing))throw new Error('Access denied'); await client.reportDefinition.update({where:{id},data:{...value,configuration:value.configuration as unknown as Prisma.InputJsonValue,updatedById:actor.id}}); return id;}
  const report=await client.reportDefinition.create({data:{...value,configuration:value.configuration as unknown as Prisma.InputJsonValue,ownerId:actor.id,createdById:actor.id,updatedById:actor.id}}); return report.id;
}
export async function duplicateReportDefinition(client: PrismaClient, actor: Actor, id: number) {
  if(!canCreateReport(actor))throw new Error('This role cannot create reports.'); const report=await client.reportDefinition.findUnique({where:{id}}); if(!report||!canViewReportDefinition(actor,report))throw new Error('Report not found.');
  return saveReportDefinition(client,actor,{name:`${report.name} (copy)`.slice(0,120),description:report.description,reportType:report.reportType,visibility:'PERSONAL',configuration:report.configuration});
}
export async function archiveReportDefinition(client: PrismaClient, actor: Actor, id: number) {
  const report=await client.reportDefinition.findUnique({where:{id}}); if(!report||report.archivedAt)throw new Error('Report not found or archived.'); if(!canEditReportDefinition(actor,report))throw new Error('Access denied'); await client.reportDefinition.update({where:{id},data:{archivedAt:new Date(),updatedById:actor.id}});
}
