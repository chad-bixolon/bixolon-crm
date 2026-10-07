import { NextRequest, NextResponse } from 'next/server';
import { getRealAuthenticatedUser } from '@/lib/current-user';
import { prisma } from '@/lib/prisma';
import { CALENDAR_STATE_COOKIE, calendarGoogleIdentity, exchangeCalendarCode, storeCalendarConnection, validateCalendarState } from '@/lib/google-calendar-oauth';

export async function GET(request: NextRequest) {
  const destination = new URL('/my-integrations', process.env.AUTH_URL || request.url);
  const state = request.nextUrl.searchParams.get('state');
  const stateCookie = request.cookies.get(CALENDAR_STATE_COOKIE)?.value;
  const real = await getRealAuthenticatedUser();
  let result = 'connected';
  if (!real || !validateCalendarState(state, stateCookie, real.id)) {
    result = 'invalid-state';
  } else if (request.nextUrl.searchParams.has('error')) {
    result = 'declined';
  } else {
    const code = request.nextUrl.searchParams.get('code');
    if (!code) result = 'failed';
    else {
      try {
        const token = await exchangeCalendarCode(code);
        const identity = await calendarGoogleIdentity(token.access_token!);
        await storeCalendarConnection(prisma, real.id, identity, token);
      } catch {
        result = 'failed';
      }
    }
  }
  destination.searchParams.set('result', result);
  const response = NextResponse.redirect(destination);
  response.cookies.delete({ name: CALENDAR_STATE_COOKIE, path: '/api/calendar/callback' });
  return response;
}
