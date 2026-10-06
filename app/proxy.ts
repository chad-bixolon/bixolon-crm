import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { routeAccess } from '@/lib/authorization';
import { DEV_IMPERSONATION_COOKIE, impersonationAdminAllowed, resolveUserContext } from '@/lib/dev-impersonation';
import { prisma } from '@/lib/prisma';

export default auth(async (request) => {
  const path = request.nextUrl.pathname;
  const rawId = request.cookies.get(DEV_IMPERSONATION_COOKIE)?.value;
  const context = await resolveUserContext(request.auth?.crmUser, rawId, prisma);
  const decision = path.startsWith('/dev/impersonation')
    ? impersonationAdminAllowed(context.real) ? 'allowed' : 'denied'
    : routeAccess(path, context.effective);
  const response = decision === 'sign-in'
    ? NextResponse.redirect(new URL(request.auth ? '/access-denied?reason=inactive' : '/sign-in', request.url))
    : decision === 'denied'
      ? NextResponse.redirect(new URL(context.real ? '/access-denied' : '/sign-in', request.url))
      : NextResponse.next();
  if (context.clearCookie) response.cookies.delete(DEV_IMPERSONATION_COOKIE);
  return response;
});
export const config = { matcher: ['/((?!api/auth/|api/internal/notifications/evaluate$|_next/static|_next/image|brand/|icon\\.png).*)'] };
