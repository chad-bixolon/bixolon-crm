'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { getRealAuthenticatedUser, requireMutation } from '@/lib/current-user';
import { assertEmailPersistenceAllowed, assertInboxActor, inboxMailboxIdentity, ignoreSupportEmail, linkSupportEmail, restoreSupportEmail } from '@/lib/support-email';
import { recentSupportMail } from '@/lib/support-gmail';
import { cookies, headers } from 'next/headers';
import { can } from '@/lib/authorization';
import { assertLiveSupportGmailRequest } from '@/lib/support-gmail-config';
import { SUPPORT_GMAIL_STATE_COOKIE, SUPPORT_GMAIL_VERIFIER_COOKIE, supportGmailCookieOptions, disconnectSupportGmail, beginSupportGmailAuthorization } from '@/lib/support-gmail-connection';

export async function connectSupportGmail() {
  const actor = await requireMutation('support-cases.write');
  assertInboxActor(actor);
  assertLiveSupportGmailRequest((await headers()).get('host'));
  const real = await getRealAuthenticatedUser();
  if (!can(real, 'support-cases.write')) throw new Error('Sign in as Support or Admin to connect Support Gmail.');
  const { state, verifier, url } = beginSupportGmailAuthorization(real!.id);
  const jar = await cookies();
  jar.set(SUPPORT_GMAIL_STATE_COOKIE, state, supportGmailCookieOptions());
  jar.set(SUPPORT_GMAIL_VERIFIER_COOKIE, verifier, supportGmailCookieOptions());
  redirect(url);
}

export async function disconnectInboxGmail() {
  const actor = await requireMutation('support-cases.write');
  assertInboxActor(actor);
  assertLiveSupportGmailRequest((await headers()).get('host'));
  const real = await getRealAuthenticatedUser();
  if (!can(real, 'support-cases.write')) throw new Error('Access denied');
  await disconnectSupportGmail(real!);
  revalidatePath('/support/inbox');
  redirect('/support/inbox?connection=disconnected');
}

export type InboxActionState = { message?: string; caseId?: string; caseNumber?: string };
function safeInboxError(error: unknown) {
  const value = error instanceof Error ? error.message : '';
  return /^(Choose a |Support Case |This email |This Gmail thread |Gmail message |Support Gmail |Connect Gmail |Invalid Support inbox |This message )/.test(value) ? value : 'Could not save this inbox action. Try again.';
}
export async function linkInboxMessage(_state: InboxActionState, form: FormData): Promise<InboxActionState> {
  const actor = await requireMutation('support-cases.write');
  assertInboxActor(actor);
  let linkedCaseId: number;
  try {
    assertEmailPersistenceAllowed();
    const messageId = String(form.get('messageId') ?? '');
    const caseNumber = String(form.get('caseNumber') ?? '').trim().toUpperCase();
    const suggestedId = Number(form.get('caseId'));
    let caseId = Number.isSafeInteger(suggestedId) && suggestedId > 0 ? suggestedId : null;
    if (caseNumber) {
      const row = await prisma.supportCase.findUnique({ where: { caseNumber }, select: { id: true } });
      if (!row) throw new Error('Support Case number not found.');
      caseId = row.id;
    }
    if (!caseId) throw new Error('Choose a Support Case or enter its exact case number.');
    const message = (await recentSupportMail()).find(item => item.id === messageId);
    if (!message) throw new Error('Gmail message not found.');
    await linkSupportEmail(prisma, actor, message, caseId);
    linkedCaseId = caseId;
  } catch (error) {
    return { message: safeInboxError(error), caseId: String(form.get('caseId') ?? ''), caseNumber: String(form.get('caseNumber') ?? '') };
  }
  revalidatePath(`/support/cases/${linkedCaseId}`);
  redirect(`/support/cases/${linkedCaseId}`);
}

export async function ignoreInboxMessage(_state: InboxActionState, form: FormData): Promise<InboxActionState> {
  const actor = await requireMutation('support-cases.write');
  assertInboxActor(actor);
  try {
    assertEmailPersistenceAllowed();
    const messageId = String(form.get('messageId') ?? '');
    if (!(await recentSupportMail()).some(message => message.id === messageId)) throw new Error('Gmail message not found.');
    await ignoreSupportEmail(prisma, actor, inboxMailboxIdentity(), messageId);
  } catch (error) { return { message: safeInboxError(error) }; }
  revalidatePath('/support/inbox');
  redirect('/support/inbox');
}

export async function restoreInboxMessage(_state: InboxActionState, form: FormData): Promise<InboxActionState> {
  const actor = await requireMutation('support-cases.write');
  assertInboxActor(actor);
  try {
    assertEmailPersistenceAllowed();
    const messageId = String(form.get('messageId') ?? '');
    if (!(await recentSupportMail()).some(message => message.id === messageId)) throw new Error('Gmail message not found.');
    await restoreSupportEmail(prisma, actor, inboxMailboxIdentity(), messageId);
  }
  catch (error) { return { message: safeInboxError(error) }; }
  revalidatePath('/support/inbox');
  redirect('/support/inbox?showIgnored=1');
}
