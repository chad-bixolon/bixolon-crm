import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { routeAccess } from '@/lib/authorization';
import { DEV_IMPERSONATION_COOKIE, impersonationAdminAllowed, resolveUserContext } from '@/lib/dev-impersonation';
import { prisma } from '@/lib/prisma';
import { readModules, requiredModulesForPath } from '@/lib/module-availability';
import { correlationIdFromHeader } from './lib/observability';

export default auth(async (request) => {
  const path = request.nextUrl.pathname;
  const requestId = correlationIdFromHeader(request.headers.get('x-request-id'));
  const forwardedHeaders = new Headers(request.headers);
  forwardedHeaders.set('x-request-id', requestId);
  const rawId = request.cookies.get(DEV_IMPERSONATION_COOKIE)?.value;
  const context = await resolveUserContext(request.auth?.crmUser, rawId, prisma);
  const decision = path.startsWith('/dev/impersonation')
    ? impersonationAdminAllowed(context.real) ? 'allowed' : 'denied'
    : routeAccess(path, context.effective);
  const required = requiredModulesForPath(path);
  // Proxy is outside the React render request cache; read current deployment state here.
  const available = decision === 'allowed' && required.length ? await readModules(prisma) : null;
  if (available && required.some(module => !available.effective.has(module))) {
    const response = path.startsWith('/api/') ? new NextResponse('Not found', { status: 404 }) : NextResponse.redirect(new URL('/module-unavailable', request.url));
    response.headers.set('x-request-id', requestId);
    return response;
  }
  const response = decision === 'sign-in'
    ? NextResponse.redirect(new URL(request.auth ? '/access-denied?reason=inactive' : '/sign-in', request.url))
    : decision === 'denied'
      ? NextResponse.redirect(new URL(context.real ? '/access-denied' : '/sign-in', request.url))
      : NextResponse.next({ request: { headers: forwardedHeaders } });
  response.headers.set('x-request-id', requestId);
  if (context.clearCookie) response.cookies.delete(DEV_IMPERSONATION_COOKIE);
  return response;
});
export const config = { matcher: ['/((?!api/auth/|api/internal/notifications/evaluate$|api/internal/calendar/sync$|api/internal/snapshots/weekly$|_next/static|_next/image|brand/|icon\\.png).*)'] };
