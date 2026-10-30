import { currentUser } from '@/lib/current-user';
import { can } from '@/lib/authorization';
import { prisma } from '@/lib/prisma';
import { finalizePartnerHandoff, historicalPartnerExport, previewPartnerHandoff } from '@/lib/trade-show-partner-handoff';
import { captureRouteError } from '@/lib/request-observability';
export const dynamic = 'force-dynamic';
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await currentUser();
  if (!can(actor, 'trade-shows.partner-handoff')) return Response.json({ error: 'Access denied' }, { status: 403 });
  const origin = request.headers.get('origin'), host = request.headers.get('host');
  try { if (!origin || !host || new URL(origin).host !== host) return Response.json({ error: 'Invalid origin.' }, { status: 403 }); }
  catch { return Response.json({ error: 'Invalid origin.' }, { status: 403 }); }
  const showId = Number((await params).id);
  try {
    if (Number(request.headers.get('content-length')) > 4096) throw new Error('Invalid handoff request.');
    const body = await request.json();
    if (body.action === 'preview') return Response.json(await previewPartnerHandoff(prisma, actor, showId, Number(body.partnerId)), { headers: { 'Cache-Control': 'private, no-store' } });
    if (body.action !== 'finalize' && body.action !== 'historical') throw new Error('Invalid handoff action.');
    if (body.action === 'finalize' && (typeof body.token !== 'string' || body.token.length > 256)) throw new Error('Invalid handoff confirmation.');
    const result = body.action === 'historical'
      ? await historicalPartnerExport(prisma, actor, showId, Number(body.batchId))
      : await finalizePartnerHandoff(prisma, actor, showId, Number(body.partnerId), body.token);
    return new Response(new Uint8Array(result.bytes), { headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${result.filename}"`, 'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff', 'X-Handoff-Batch': String(result.batchId),
    } });
  } catch (error) {
    const conflict = !!error && typeof error === 'object' && 'code' in error && ['P2034','P2002','P2025'].includes(String(error.code));
    if (conflict) return Response.json({ error: 'This record changed. Refresh and review a new handoff preview.' }, { status: 409 });
    const incident = captureRouteError(request, error, 'partner_handoff.failed', { userId: actor.id, entityId: showId, module: 'TRADE_SHOWS' });
    return Response.json({ error: incident ?? (error instanceof Error ? error.message : 'Export unavailable.') }, { status: incident ? 500 : 400 });
  }
}
