import type {ReactNode} from 'react';
import {currentUser} from '@/lib/current-user';
import {can} from '@/lib/authorization';
import {prisma} from '@/lib/prisma';
import {archivePriceException,restorePriceException} from './actions';
import {scopedPriceExceptionWhere} from '@/lib/price-exception-visibility';

export default async function PriceExceptionDetailLayout({children,params}:{children:ReactNode;params:Promise<{id:string}>}){
  const actor=await currentUser();const id=Number((await params).id);
  const pe=Number.isSafeInteger(id)&&id>0?await prisma.priceException.findFirst({where:scopedPriceExceptionWhere(actor,{id}),select:{archivedAt:true}}):null;
  return <>{children}{pe&&can(actor,'users.manage')&&<aside className="mx-auto mb-8 max-w-7xl px-5 lg:px-8"><form action={pe.archivedAt?restorePriceException:archivePriceException} className="panel flex items-center justify-between gap-4 p-4"><input type="hidden" name="id" value={id}/><p className="text-sm text-slate-600">{pe.archivedAt?'Restore this retained commercial record.':'Archive this finalized commercial record. Re-imports will preserve the archived state.'}</p><button className="btn-secondary" type="submit">{pe.archivedAt?'Restore Price Exception':'Archive Price Exception'}</button></form></aside>}</>;
}
