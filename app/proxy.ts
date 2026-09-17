import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { routeAccess } from '@/lib/authorization';

export default auth((request) => {
  const path = request.nextUrl.pathname;
  const user = request.auth?.crmUser;
  const decision = routeAccess(path, user ?? null);
  if (decision === 'sign-in') return NextResponse.redirect(new URL(request.auth ? '/access-denied?reason=inactive' : '/sign-in', request.url));
  if (decision === 'denied') return NextResponse.redirect(new URL(user ? '/access-denied' : '/access-denied?reason=inactive', request.url));
  return NextResponse.next();
});
export const config = { matcher: ['/((?!api/auth/|_next/static|_next/image|favicon.ico).*)'] };
