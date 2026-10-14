import { NextRequest, NextResponse } from 'next/server';
import { getRealAuthenticatedUser } from '@/lib/current-user';
import { supportGmailOrigin, assertLiveSupportGmailRequest } from '@/lib/support-gmail-config';
import { SUPPORT_GMAIL_STATE_COOKIE, SUPPORT_GMAIL_VERIFIER_COOKIE, completeSupportGmailAuthorization } from '@/lib/support-gmail-connection';

export const runtime = 'nodejs';
export async function GET(request: NextRequest) {
  try { assertLiveSupportGmailRequest(request.headers.get('host')); }
  catch { return new NextResponse('Support Gmail OAuth is unavailable for this environment.', { status: 404, headers: { 'Cache-Control': 'private, no-store' } }); }
  const result = await completeSupportGmailAuthorization({
    actor: await getRealAuthenticatedUser(), state: request.nextUrl.searchParams.get('state'),
    cookie: request.cookies.get(SUPPORT_GMAIL_STATE_COOKIE)?.value, verifier: request.cookies.get(SUPPORT_GMAIL_VERIFIER_COOKIE)?.value,
    code: request.nextUrl.searchParams.get('code'), error: request.nextUrl.searchParams.get('error'),
  });
  const destination = new URL('/support/inbox', supportGmailOrigin());
  destination.searchParams.set('connection', result);
  const response = NextResponse.redirect(destination);
  response.headers.set('Cache-Control', 'private, no-store');
  for (const name of [SUPPORT_GMAIL_STATE_COOKIE, SUPPORT_GMAIL_VERIFIER_COOKIE]) response.cookies.delete({ name, path: '/api/support-gmail/callback' });
  return response;
}
