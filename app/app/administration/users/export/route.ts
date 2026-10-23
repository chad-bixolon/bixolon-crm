import { requirePermission } from '@/lib/current-user';
import { prisma } from '@/lib/prisma';
import { exportUserCsv } from '@/lib/user-csv';
import { recordVisibility } from '@/lib/record-visibility';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const actor = await requirePermission('users.export');
  const visibility = recordVisibility(new URL(request.url).searchParams.get('visibility') ?? undefined);
  const csv = await exportUserCsv(prisma, actor, visibility);
  return new Response(csv, { headers: { 'Content-Type':'text/csv; charset=utf-8', 'Content-Disposition':`attachment; filename="saleshub-users-${visibility}.csv"`, 'Cache-Control':'private, no-store', 'X-Content-Type-Options':'nosniff' } });
}
