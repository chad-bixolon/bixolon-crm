import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { currentUser } from '@/lib/current-user';
import { prisma } from '@/lib/prisma';
import { canUseSavedViews, isSavedViewRoute, normalizeSavedQuery } from '@/lib/saved-views';
import { listSavedViews, savedStateForDb, setSavedViewDefault } from '@/lib/saved-view-store';

const error = (message: string, status = 400) => NextResponse.json({ error: message }, { status });
function route(value: unknown) { return typeof value === 'string' && isSavedViewRoute(value) ? value : null; }
function sameOrigin(request: NextRequest) {
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  if (!origin || !host) return false;
  try { return new URL(origin).host === host; } catch { return false; }
}
function name(value: unknown) { return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : ''; }
async function body(request: NextRequest) {
  const raw = await request.text();
  if (raw.length > 4096) throw new Error('Saved view is too large.');
  return JSON.parse(raw) as Record<string, unknown>;
}
async function actorFor(routeKey: string) {
  const actor = await currentUser();
  if (!isSavedViewRoute(routeKey) || !canUseSavedViews(actor, routeKey)) return null;
  return actor;
}
function responseViews(routeKey: keyof typeof import('@/lib/saved-views').savedViewRoutes, actor: Awaited<ReturnType<typeof currentUser>>) {
  return listSavedViews(routeKey, actor).then(views => NextResponse.json({ views }, { headers: { 'Cache-Control': 'private, no-store' } }));
}

export async function GET(request: NextRequest) {
  const routeKey = request.nextUrl.searchParams.get('route') ?? '';
  const actor = await actorFor(routeKey);
  if (!actor || !isSavedViewRoute(routeKey)) return error('Access denied.', 403);
  return responseViews(routeKey, actor);
}
export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return error('Invalid origin.', 403);
  try {
    const data = await body(request); const routeKey = route(data.routeKey);
    if (!routeKey) return error('Invalid route.');
    const actor = await actorFor(routeKey); if (!actor) return error('Access denied.', 403);
    const viewName = name(data.name);
    if (!viewName || viewName.length > 80) return error('Enter a view name of 1–80 characters.');
    const query = normalizeSavedQuery(routeKey, data.query);
    if (!Object.keys(query).length && data.allowEmpty !== true) return error('Choose a filter, search, sort, or explicitly save a named default view.');
    if (await prisma.savedView.count({ where: { userId: actor.id, routeKey } }) >= 50) return error('You can save up to 50 views per page.');
    await prisma.$transaction(async tx => {
      if (data.isDefault === true) await tx.savedView.updateMany({ where: { userId: actor.id, routeKey, isDefault: true }, data: { isDefault: false } });
      await tx.savedView.create({ data: { userId: actor.id, routeKey, name: viewName, queryState: savedStateForDb(query), isDefault: data.isDefault === true } });
    }, { isolationLevel: 'Serializable' });
    return responseViews(routeKey, actor);
  } catch (cause) {
    if (cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === 'P2002') return error('You already have a view with that name on this page.', 409);
    return error(cause instanceof Error && cause.message === 'Saved view is too large.' ? cause.message : 'Could not save the view.');
  }
}
export async function PATCH(request: NextRequest) {
  if (!sameOrigin(request)) return error('Invalid origin.', 403);
  try {
    const data = await body(request); const routeKey = route(data.routeKey); const id = Number(data.id);
    if (!routeKey || !Number.isSafeInteger(id) || id < 1) return error('Invalid view.');
    const actor = await actorFor(routeKey); if (!actor) return error('Access denied.', 403);
    const existing = await prisma.savedView.findFirst({ where: { id, userId: actor.id, routeKey } });
    if (!existing) return error('View not found.', 404);
    if (data.action === 'rename') {
      const viewName = name(data.name); if (!viewName || viewName.length > 80) return error('Enter a view name of 1–80 characters.');
      await prisma.savedView.update({ where: { id }, data: { name: viewName } });
    } else if (data.action === 'default') await setSavedViewDefault(actor.id, routeKey, data.isDefault === true ? id : null);
    else return error('Invalid action.');
    return responseViews(routeKey, actor);
  } catch (cause) {
    if (cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === 'P2002') return error('You already have a view with that name on this page.', 409);
    return error('Could not update the view.');
  }
}
export async function DELETE(request: NextRequest) {
  if (!sameOrigin(request)) return error('Invalid origin.', 403);
  try {
    const data = await body(request); const routeKey = route(data.routeKey); const id = Number(data.id);
    if (!routeKey || !Number.isSafeInteger(id) || id < 1) return error('Invalid view.');
    const actor = await actorFor(routeKey); if (!actor) return error('Access denied.', 403);
    const result = await prisma.savedView.deleteMany({ where: { id, userId: actor.id, routeKey } });
    if (!result.count) return error('View not found.', 404);
    return responseViews(routeKey, actor);
  } catch { return error('Could not delete the view.'); }
}
