'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getRealAuthenticatedUser } from '@/lib/current-user';
import { prisma } from '@/lib/prisma';
import { CALENDAR_STATE_COOKIE, calendarAuthorizationUrl, createCalendarState, disconnectCalendar, realCalendarUserId } from '@/lib/google-calendar-oauth';
import { syncGoogleCalendarConnection } from '@/lib/google-calendar-sync';
import { saveOwnTimeZone } from '@/lib/user-time-zone';

export async function saveMyTimeZone(form: FormData) {
  const real = await getRealAuthenticatedUser();
  await saveOwnTimeZone(prisma, real, form.get('timeZone'));
  redirect('/my-integrations?result=time-zone-saved');
}

export async function connectGoogleCalendar() {
  const real = await getRealAuthenticatedUser();
  const userId = realCalendarUserId(real);
  const state = createCalendarState(userId);
  const url = calendarAuthorizationUrl(state);
  (await cookies()).set(CALENDAR_STATE_COOKIE, state, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/api/calendar/callback', maxAge: 600 });
  redirect(url);
}

export async function disconnectGoogleCalendar() {
  const real = await getRealAuthenticatedUser();
  await disconnectCalendar(prisma, realCalendarUserId(real));
  redirect('/my-integrations?result=disconnected');
}

export async function syncMyGoogleCalendar() {
  const real = await getRealAuthenticatedUser();
  const userId = realCalendarUserId(real);
  const connection = await prisma.googleCalendarConnection.findUnique({ where: { userId }, select: { id: true } });
  if (!connection) redirect('/my-integrations?result=not-connected');
  const result = await syncGoogleCalendarConnection(prisma, connection.id);
  redirect(`/my-integrations?result=${result.success ? 'synced' : result.reason === 'reauth' ? 'reauth' : result.reason === 'busy' ? 'busy' : 'sync-failed'}`);
}
