import * as XLSX from 'xlsx';
import { NextRequest,NextResponse } from 'next/server';
import { currentUser } from '@/lib/current-user';
import { can } from '@/lib/authorization';
import { prisma } from '@/lib/prisma';
import { supportReport,type SupportReportFilters } from '@/lib/support-report';
import { supportReportWorkbook } from '@/lib/support-report-workbook';
export const dynamic='force-dynamic';
export async function GET(request:NextRequest){
  const actor=await currentUser();if(!can(actor,'support-cases.read')||!can(actor,'accounts.read'))return new NextResponse('Access denied',{status:403});
  const filters=Object.fromEntries(request.nextUrl.searchParams) as SupportReportFilters;
  const report=await supportReport(prisma,actor,filters,{all:true});
  const user=await prisma.user.findUnique({where:{id:actor.id},select:{firstName:true,lastName:true}});
  const book=supportReportWorkbook(report,filters,user?`${user.firstName} ${user.lastName}`:'Current user');
  const bytes=XLSX.write(book,{type:'buffer',bookType:'xlsx',compression:true,cellDates:true}) as Buffer;
  return new NextResponse(new Uint8Array(bytes),{headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':'attachment; filename="support-cases.xlsx"','Cache-Control':'private, no-store'}});
}
