'use server';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { requireMutation } from '@/lib/current-user';

export async function archivePriceException(form:FormData){
  const actor=await requireMutation('users.manage');
  const id=Number(form.get('id'));
  if(!Number.isSafeInteger(id)||id<=0)throw new Error('Invalid Price Exception.');
  await prisma.priceException.update({where:{id},data:{status:'ARCHIVED',archivedAt:new Date(),updatedById:actor.id}});
  revalidatePath('/price-exceptions');revalidatePath(`/price-exceptions/${id}`);revalidatePath('/accounts');
}
