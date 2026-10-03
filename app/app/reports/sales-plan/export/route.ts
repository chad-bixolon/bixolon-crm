import { NextRequest, NextResponse } from 'next/server';
import { currentUser } from '@/lib/current-user';
import { prisma } from '@/lib/prisma';
import { buildSalesPlanManagementExport, exportAccess, exportSelection, writeSalesPlanWorkbook } from '@/lib/sales-plan-export';

export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
  const actor = await currentUser();
  if (!exportAccess(actor)) return new NextResponse('Access denied', { status: 403 });
  let selection: ReturnType<typeof exportSelection>;
  try { selection = exportSelection(Object.fromEntries(request.nextUrl.searchParams)); }
  catch { return new NextResponse('Choose a valid year, currency, and sales rep.', { status: 400 }); }
  const currency = await prisma.currency.findUnique({ where: { code: selection.currencyCode }, select: { active: true } });
  if (!currency?.active) return new NextResponse('Choose an active currency.', { status: 400 });
  const result = await buildSalesPlanManagementExport(prisma, actor, selection);
  const buffer = writeSalesPlanWorkbook(result.workbook);
  return new NextResponse(new Uint8Array(buffer), { headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="${result.filename}"`, 'Cache-Control': 'private, no-store' } });
}
