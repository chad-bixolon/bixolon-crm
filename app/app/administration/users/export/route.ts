import { requirePermission } from '@/lib/current-user';
import { prisma } from '@/lib/prisma';
import { exportUserCsv } from '@/lib/user-csv';
import { recordVisibility } from '@/lib/record-visibility';
import { captureRouteError } from '../../../../lib/request-observability';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const actor = await requirePermission('users.export');
  const visibility = recordVisibility(new URL(request.url).searchParams.get('visibility') ?? undefined);
  let csv: string;
  try { csv = await exportUserCsv(prisma, actor, visibility); }
  catch (error) { const incident = captureRouteError(request, error, 'user.export', { userId: actor.id }); return Response.json({ error: incident ?? 'Export unavailable.' }, { status: incident ? 500 : 400 }); }
  return new Response(csv, { headers: { 'Content-Type':'text/csv; charset=utf-8', 'Content-Disposition':`attachment; filename="saleshub-users-${visibility}.csv"`, 'Cache-Control':'private, no-store', 'X-Content-Type-Options':'nosniff' } });
}
