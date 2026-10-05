import * as XLSX from 'xlsx';
import { NextRequest, NextResponse } from 'next/server';
import { currentUser } from '@/lib/current-user';
import { prisma } from '@/lib/prisma';
import { canViewExpirationReport, expiringReport, type ExpiringFilters } from '@/lib/price-exception-expiration';
import { expiringWorkbook } from '@/lib/price-exception-expiration-workbook';

export const dynamic='force-dynamic';
export async function GET(request:NextRequest) {
  const actor=await currentUser();if(!canViewExpirationReport(actor))return new NextResponse('Access denied',{status:403});
  const filters=Object.fromEntries(request.nextUrl.searchParams) as ExpiringFilters;
  const report=await expiringReport(prisma,actor,filters,{all:true});
  const user=await prisma.user.findUnique({where:{id:actor.id},select:{firstName:true,lastName:true}});
  const workbook=expiringWorkbook(report,filters,user?`${user.firstName} ${user.lastName}`:`User ${actor.id}`);
  const bytes=XLSX.write(workbook,{type:'buffer',bookType:'xlsx',compression:true}) as Buffer;
  return new NextResponse(new Uint8Array(bytes),{headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':'attachment; filename="expiring-price-exceptions.xlsx"','Cache-Control':'private, no-store'}});
}
