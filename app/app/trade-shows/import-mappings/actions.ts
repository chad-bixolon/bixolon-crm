'use server';
import { revalidatePath } from 'next/cache';
import { requireMutation } from '@/lib/current-user';
import { prisma } from '@/lib/prisma';
import { renameTradeShowImportMapping, setTradeShowImportMappingArchived } from '@/lib/trade-show-import-mappings';

export async function renameMappingAction(form:FormData){const actor=await requireMutation('trade-shows.manage');await renameTradeShowImportMapping(prisma,Number(form.get('id')),String(form.get('name')??''),actor);revalidatePath('/trade-shows/import-mappings');}
export async function archiveMappingAction(form:FormData){const actor=await requireMutation('trade-shows.manage');await setTradeShowImportMappingArchived(prisma,Number(form.get('id')),String(form.get('archived'))==='true',actor);revalidatePath('/trade-shows/import-mappings');}
