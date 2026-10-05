import * as XLSX from 'xlsx';
import { NextRequest, NextResponse } from 'next/server';
import { currentUser } from '@/lib/current-user';
import { prisma } from '@/lib/prisma';
import { exportSelection } from '@/lib/sales-plan-export';
import { rollupAccess, salesPlanSkuRollup, skuRollupFilename } from '@/lib/sales-plan-sku-rollup';
import { salesPlanSkuWorkbook } from '@/lib/sales-plan-sku-workbook';

export const dynamic='force-dynamic';
const optionalId=(value:string|null)=>value===null||value===''?null:/^[1-9]\d*$/.test(value)&&Number.isSafeInteger(Number(value))?Number(value):NaN;
export async function GET(request:NextRequest) {
  const actor=await currentUser();if(!rollupAccess(actor))return new NextResponse('Access denied',{status:403});
  let selection:ReturnType<typeof exportSelection>;
  try{selection=exportSelection(Object.fromEntries(request.nextUrl.searchParams));}catch{return new NextResponse('Choose a valid year, currency, and sales rep.',{status:400});}
  const productId=optionalId(request.nextUrl.searchParams.get('productId')),skuId=optionalId(request.nextUrl.searchParams.get('skuId')),accountId=optionalId(request.nextUrl.searchParams.get('accountId'));
  if([productId,skuId,accountId].some(Number.isNaN))return new NextResponse('Choose valid filters.',{status:400});
  const currency=await prisma.currency.findUnique({where:{code:selection.currencyCode},select:{active:true}});
  if(!currency?.active)return new NextResponse('Choose an active currency.',{status:400});
  const report=await salesPlanSkuRollup(prisma,actor,{...selection,productId,skuId,accountId,search:request.nextUrl.searchParams.get('search')?.slice(0,100)});
  const rep=selection.userId===null?null:await prisma.user.findUnique({where:{id:selection.userId},select:{firstName:true,lastName:true}});
  const filename=skuRollupFilename(selection.year,selection.currencyCode,rep?`${rep.firstName} ${rep.lastName}`:undefined);
  const workbook=salesPlanSkuWorkbook(report.rows,report.lines.filter(l=>l.skuId!==null),report.unresolved,selection.currencyCode,{year:selection.year,rep:rep?`${rep.firstName} ${rep.lastName}`:'All planned reps',generatedAt:new Date(),summary:report.summary});
  const buffer=XLSX.write(workbook,{type:'buffer',bookType:'xlsx',compression:true}) as Buffer;
  return new NextResponse(new Uint8Array(buffer),{headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':`attachment; filename="${filename}"`,'Cache-Control':'private, no-store'}});
}
