import { redirect } from 'next/navigation';
import { Content, PageHeader } from '@/components/shell';
import { getRealAuthenticatedUser } from '@/lib/current-user';
import { prisma } from '@/lib/prisma';
import { connectGoogleCalendar, disconnectGoogleCalendar, saveMyTimeZone, syncMyGoogleCalendar } from './actions';
import { formatDateTimeForUser } from '@/lib/display-format';
import { USER_TIME_ZONE_OPTIONS } from '@/lib/user-time-zone';

const notices: Record<string, string> = {
  connected: 'Google Calendar connected.',
  disconnected: 'Google Calendar disconnected.',
  'invalid-state': 'Connection request expired or did not match your signed-in account. Please try again.',
  declined: 'Google Calendar permission was not granted.',
  failed: 'Could not connect Google Calendar. Check that you chose your SalesHub Google account and granted read-only Calendar access, then try again.',
  synced: 'Google Calendar sync completed.',
  'sync-failed': 'Google Calendar sync failed. Please try again later.',
  reauth: 'Google Calendar needs reauthorization before syncing.',
  busy: 'Google Calendar is already syncing. Please try again shortly.',
  'not-connected': 'Connect Google Calendar before syncing.',
  'time-zone-saved': 'Time zone saved.',
};

export default async function MyIntegrationsPage({ searchParams }: { searchParams: Promise<{ result?: string }> }) {
  const real = await getRealAuthenticatedUser();
  if (!real) redirect('/sign-in');
  const [user, connection] = await Promise.all([
    prisma.user.findUnique({ where: { id: real.id }, select: { timeZone: true } }),
    prisma.googleCalendarConnection.findUnique({ where: { userId: real.id }, select: { googleEmail: true, connectionStatus: true, lastConnectedAt: true, lastSuccessfulSyncAt: true, lastSyncCompletedAt: true, lastError: true } }),
  ]);
  if (!user) redirect('/access-denied?reason=inactive');
  const displayTime = (value: Date) => formatDateTimeForUser(value, user.timeZone);
  const result = (await searchParams).result;
  return <Content><PageHeader eyebrow="Personal integrations" title="My integrations" description={`Connections belong to your signed-in SalesHub account (${real.email}).`} />
    {result && notices[result] && <p role="status" className="mb-5 rounded-md bg-slate-100 p-3 text-sm">{notices[result]}</p>}
    <section className="panel mb-5 max-w-2xl space-y-4 p-6" aria-labelledby="personal-settings-heading">
      <h2 id="personal-settings-heading" className="text-xl font-semibold">Personal settings</h2>
      <form action={saveMyTimeZone} className="inline-field-action">
        <label className="label">Time Zone
          <select className="field mt-1" name="timeZone" defaultValue={user.timeZone} required>
            {USER_TIME_ZONE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label} ({option.value})</option>)}
          </select>
        </label>
        <button className="btn-primary" type="submit">Save</button>
      </form>
      <p className="text-sm text-slate-600">Calendar times display in your saved time zone. Your browser time zone does not change this setting.</p>
    </section>
    <section className="panel max-w-2xl space-y-4 p-6" aria-labelledby="google-calendar-heading">
      <h2 id="google-calendar-heading" className="text-xl font-semibold">Google Calendar</h2>
      {!connection ? <><p>Connect your Google Calendar to sync events for future Activity review.</p><p className="text-sm text-slate-600">Read-only access. SalesHub does not create or edit Google Calendar events.</p><form action={connectGoogleCalendar}><button className="btn-primary" type="submit">Connect Google Calendar</button></form></> : <>
        <p className="text-sm">Google account: <strong>{connection.googleEmail}</strong></p>
        <p className="text-sm">Status: <strong>{connection.connectionStatus === 'CONNECTED' ? 'Connected' : 'Needs reauthorization'}</strong></p>
        <p className="text-sm">Last connected: {displayTime(connection.lastConnectedAt)}</p>
        <p className="text-sm">Last successful sync: {connection.lastSuccessfulSyncAt ? displayTime(connection.lastSuccessfulSyncAt) : 'Never'}</p>
        {connection.lastSyncCompletedAt && <p className="text-sm">Last sync result ({displayTime(connection.lastSyncCompletedAt)}): {connection.lastError ? connection.lastError : 'Completed successfully'}</p>}
        <p className="text-sm text-slate-600">Read-only access. Events are stored for future review; no Activities are created by sync.</p>
        <div className="form-action-row">{connection.connectionStatus === 'CONNECTED' && <form action={syncMyGoogleCalendar}><button className="btn-primary" type="submit">Sync now</button></form>}<form action={connectGoogleCalendar}><button className="btn-secondary" type="submit">Reconnect / Reauthorize</button></form><form action={disconnectGoogleCalendar}><button className="btn-secondary" type="submit">Disconnect</button></form></div>
      </>}
    </section>
  </Content>;
}
