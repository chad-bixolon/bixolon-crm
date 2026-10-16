import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Content, PageHeader } from '@/components/shell';
import { NAV_CATEGORIES } from '@/lib/navigation-categories';
import { requirePermission } from '@/lib/current-user';
import { prisma } from '@/lib/prisma';
import { recentSupportMail, supportGmailEnabled, supportGmailFetchStatus, supportGmailLookbackDays, supportGmailMode, supportGmailMockMode, supportGmailTestFixtureMode } from '@/lib/support-gmail';
import { connectionStatus, supportGmailClientConfigured } from '@/lib/support-gmail-connection';
import { supportGmailEnvironmentIssue } from '@/lib/support-gmail-config';
import { signEmailSource } from '@/lib/support-email-source';
import { inboxMailboxIdentity, suggestSupportEmails } from '@/lib/support-email';
import { connectSupportGmail, disconnectInboxGmail } from './actions';
import { InboxMessageActions } from './message-actions';
import { LocalFetchTime } from './local-fetch-time';
import { InboxDisclosure } from './disclosure';
import { inboxMatchSummary, inboxAttachmentLabel } from '@/lib/support-inbox-display';

export const dynamic = 'force-dynamic';
export default async function SupportInboxPage({ searchParams }: { searchParams: Promise<{ connection?: string; showIgnored?: string }> }) {
  if (!supportGmailEnabled()) notFound();
  const actor = await requirePermission('support-cases.write');
  const heading = <div className="[&>div]:mb-3"><PageHeader eyebrow={NAV_CATEGORIES.support} title="Support Inbox" action={<Link href="/support/cases" className="btn-secondary">Support Cases</Link>}/></div>;
  const mock = supportGmailMockMode();
  const mode = supportGmailMode();
  const lookback = supportGmailLookbackDays();
  const fixture = supportGmailTestFixtureMode();
  const environmentIssue = mock || fixture ? null : supportGmailEnvironmentIssue();
  if (environmentIssue) return <Content>{heading}<p role="alert" className="panel p-4">{environmentIssue}</p></Content>;
  let status;
  try { status = mock || fixture ? { connected: fixture, email: fixture ? process.env.SUPPORT_GMAIL_MAILBOX ?? null : null, connectedAt: null } : await connectionStatus(); }
  catch { return <Content>{heading}<p role="alert" className="panel p-4">Support Gmail connection could not be loaded. Ask an administrator to check the mailbox settings and database migrations.</p></Content>; }
  const params = await searchParams;
  const result = params.connection;
  const connectionPanel = () => {
    const fetch = supportGmailFetchStatus();
    const synced = fetch.at ?? ('lastSyncedAt' in status ? status.lastSyncedAt : null);
    return <section className="mb-3 text-sm text-slate-600" aria-label="Mailbox status">
      <InboxDisclosure label="Manage" summary={<p key="mailbox-summary" className="min-w-0 flex-1">
        <span aria-hidden="true" className={`mr-1.5 inline-block h-2 w-2 rounded-full ${status.connected ? 'bg-emerald-600' : 'bg-slate-400'}`}/>
        <span className="font-medium text-slate-700">{mock ? 'Gmail disconnected (mock messages)' : fixture ? 'Gmail connected (simulated)' : status.connected ? 'Gmail connected' : 'Gmail disconnected'}</span>
        {' · '}<span className="break-all">{status.email || process.env.SUPPORT_GMAIL_MAILBOX || 'Mailbox not configured'}</span>
        {' · '}<span className="inline-block">Last synced {synced ? <LocalFetchTime iso={synced.toISOString()}/> : 'Not yet'}</span>
      </p>}>
        <div key="mailbox-details" className="mt-1 rounded-md border border-slate-200 bg-white p-3">
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-xs sm:grid-cols-2">
            <div><dt className="inline font-medium">Access: </dt><dd className="inline">Gmail read-only</dd></div>
            <div><dt className="inline font-medium">Mode: </dt><dd className="inline">{mode}</dd></div>
            <div><dt className="inline font-medium">Window: </dt><dd className="inline">Showing messages from the last {lookback} days</dd></div>
            <div><dt className="inline font-medium">Maximum inbox messages: </dt><dd className="inline">50</dd></div>
            <div><dt className="inline font-medium">Last successful fetch: </dt><dd className="inline">{synced ? <LocalFetchTime iso={synced.toISOString()}/> : 'Not yet'}</dd></div>
            <div><dt className="inline font-medium">Last fetch result: </dt><dd className="inline">{fetch.result}</dd></div>
          </dl>
          {!mock && !status.connected && !supportGmailClientConfigured() && <p className="mt-2 text-sm">Configure the dedicated Support Google OAuth client in the SalesHub environment.</p>}
          {!mock && !fixture && <div key="gmail-actions" className="mt-3 flex flex-wrap gap-2">
            <form key="connect" action={connectSupportGmail}><button className="btn-secondary" disabled={!supportGmailClientConfigured()} type="submit">{status.connected ? 'Reconnect Support Gmail' : 'Connect Support Gmail'}</button></form>
            {status.connected && <form key="disconnect" action={disconnectInboxGmail}><button className="btn-secondary" type="submit">Disconnect Gmail</button></form>}
          </div>}
        </div>
      </InboxDisclosure>
      {result && result !== 'connected' && <p role="alert" className="mt-2 text-sm text-red-700">{result === 'declined' ? 'Google access was declined.' : result === 'invalid-state' ? 'Connection expired. Try again.' : result === 'disconnected' ? 'Mailbox disconnected from SalesHub.' : 'Connection failed. Check OAuth settings and mailbox access.'}</p>}
      <p className="mt-1 text-xs text-slate-500" role="note">Gmail is read-only. SalesHub actions do not modify the mailbox.</p>
    </section>;
  };
  if (!mock && !status.connected) return <Content>{heading}{connectionPanel()}<p className="panel p-4 text-sm text-slate-600">Connect Support Gmail from Manage to view recent messages.</p></Content>;
  let messages;
  try { messages = await recentSupportMail(); }
  catch (error) { return <Content>{heading}{connectionPanel()}<p role="alert" className="panel p-5 text-red-700">{error instanceof Error ? error.message : 'Could not read Support mailbox.'}</p></Content>; }
  const mailbox = inboxMailboxIdentity();
  const dismissals = await prisma.supportInboxDismissal.findMany({ where: { mailbox, gmailMessageId: { in: messages.map(message => message.id) } }, select: { gmailMessageId: true } });
  const ignoredIds = new Set(dismissals.map(row => row.gmailMessageId));
  const rows = await suggestSupportEmails(prisma, messages.filter(message => !ignoredIds.has(message.id)));
  const ignored = params.showIgnored === '1' ? messages.filter(message => ignoredIds.has(message.id)) : [];
  const threadCounts = new Map<string, number>();
  for (const message of messages) threadCounts.set(message.threadId, (threadCounts.get(message.threadId) ?? 0) + 1);
  return <Content>{heading}{connectionPanel()}
    <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
      <p>{rows.length} recent messages</p>
      <Link className="rounded py-2 text-orange-800 underline focus-visible:outline-2 focus-visible:outline-orange-600" href={params.showIgnored === '1' ? '/support/inbox' : '/support/inbox?showIgnored=1'}>{params.showIgnored === '1' ? 'Hide ignored messages' : `Show ignored messages (${ignoredIds.size})`}</Link>
    </div>
    <div className="space-y-3">{rows.map(({ message, suggestion }) => {
      const match = inboxMatchSummary(suggestion);
      const attachments = inboxAttachmentLabel(message);
      return <article className="panel p-4" key={message.id} aria-labelledby={`message-${message.id}`} data-message-state={suggestion.alreadyLinkedCaseId ? 'linked' : match.needsReview ? 'needs-review' : 'unhandled'}>
        <h2 id={`message-${message.id}`} className="break-words font-semibold text-slate-950">{message.subject}</h2>
        <div className="mt-1 flex min-w-0 flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm">
          <p className="min-w-0 break-all text-slate-700">{message.senderName && <span className="font-medium">{message.senderName} </span>}&lt;{message.senderEmail}&gt;</p>
          <span className="text-xs text-slate-500"><LocalFetchTime iso={message.messageDate.toISOString()}/></span>
        </div>
        <p className="mt-2 line-clamp-2 break-words text-sm leading-6 text-slate-600">{message.snippet || message.bodyText.slice(0, 300) || 'No message preview available.'}</p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs" aria-label="Message status">
          {suggestion.alreadyLinkedCaseId && <span className="rounded bg-emerald-50 px-2 py-1 text-emerald-800">Linked</span>}
          {message.senderEmail.toLowerCase().endsWith('@bixolonusa.com') && <span className="rounded bg-slate-100 px-2 py-1 text-slate-600">Internal sender</span>}
          {match.confidence && <span className={`rounded px-2 py-1 ${match.needsReview ? 'bg-amber-50 text-amber-800' : 'bg-slate-100 text-slate-600'}`}>{match.confidence}</span>}
          {attachments && <span className="rounded bg-slate-100 px-2 py-1 text-slate-600" title="Optional file import is available when creating a Case; decorative inline images are excluded from this count.">{attachments}</span>}
          {(threadCounts.get(message.threadId) ?? 0) > 1 && <span className="text-slate-500">{threadCounts.get(message.threadId)} messages in thread</span>}
        </div>
        <InboxDisclosure label="Match details" className="mt-1 text-sm text-slate-600" summary={<p key="mailbox-summary" className="min-w-0 flex-1">{match.summary}</p>}>
          <div key="match-details" className="mt-1 space-y-1 rounded-md bg-slate-50 p-3 text-xs">
            <p>Suggested Contact: {suggestion.contact ? `${suggestion.contact.firstName} ${suggestion.contact.lastName} — Exact Contact match by sender email` : 'None'}</p>
            {suggestion.ambiguousContact && <p>Multiple Contacts share this email — no Contact auto-suggestion</p>}
            <p>Suggested Account: {suggestion.account ? `${suggestion.account.name} — Account suggested from matched Contact` : 'None'}</p>
            <div>Suggested Cases: {suggestion.suggestedCases.length ? <ul className="mt-1 space-y-1 pl-4">{suggestion.suggestedCases.map(row => <li className="break-words" key={row.id}>{row.caseNumber} ({row.status}) — {row.id === suggestion.linkedThreadCaseId ? 'Case suggested because this Gmail thread is already linked' : row.id === suggestion.numberedCaseId ? `Case suggested from ${row.caseNumber} in the message` : suggestion.relatedCaseCount === 1 ? 'One related open Support Case found for this Contact or Account' : 'Related open Support Case for this Contact or Account — review required'}</li>)}</ul> : 'None'}</div>
            {suggestion.relatedCaseCount > 1 && <p>Multiple possible cases — review required</p>}
            {suggestion.threadConflict && <p>Thread links conflict — review required</p>}
            {suggestion.caseReferenceConflict && <p>Thread link and case number disagree — review required</p>}
            {suggestion.multipleCaseReferences && <p>Multiple case numbers found — review required</p>}
          </div>
        </InboxDisclosure>
        <InboxMessageActions emailSource={signEmailSource(actor, message)} messageId={message.id} suggestedCases={suggestion.suggestedCases} linked={!!suggestion.alreadyLinkedCaseId}/>
      </article>;
    })}{!rows.length && <p className="panel p-5">No unignored recent messages.</p>}</div>
    {params.showIgnored === '1' && <section className="mt-6 space-y-3" aria-label="Ignored messages"><h2 className="text-lg font-semibold">Ignored messages</h2>{ignored.map(message => <article className="panel p-4" key={message.id} data-message-state="ignored"><p className="break-words font-medium">{message.subject}</p><p className="break-all text-sm text-slate-600">{message.senderEmail}</p><InboxMessageActions emailSource={signEmailSource(actor, message)} messageId={message.id} suggestedCases={[]} ignored/></article>)}{!ignored.length && <p className="panel p-4 text-sm">No ignored messages in this recent window.</p>}</section>}
  </Content>;
}
