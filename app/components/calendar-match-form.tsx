'use client';
import { useState } from 'react';
import { RecoverableActionForm } from '@/components/recoverable-action-form';
import { saveCalendarSelection } from '@/app/calendar-matches/actions';
import { EntityPicker, type PickerResult } from './entity-picker';
import { ActivityContactPicker } from './activity-contact-picker';
import type { workOptions } from '@/lib/work-options';
import type { ContactOption } from '@/lib/activity-relations';

type Options = Awaited<ReturnType<typeof workOptions>>;
export function CalendarMatchForm({ eventId, options, initial }: { eventId: number; options: Options; initial: { accountId: number | null; contactIds: number[]; opportunityId: number | null; projectId: number | null } }) {
  const [account, setAccount] = useState<PickerResult | null>(() => options.accounts.find(row => row.id === initial.accountId) ? { ...options.accounts.find(row => row.id === initial.accountId)!, context: null } : null);
  const [opportunity, setOpportunity] = useState<PickerResult | null>(() => options.opportunities.find(row => row.id === initial.opportunityId) ? { ...options.opportunities.find(row => row.id === initial.opportunityId)!, context: null } : null);
  const [project, setProject] = useState<PickerResult | null>(() => options.projects.find(row => row.id === initial.projectId) ? { ...options.projects.find(row => row.id === initial.projectId)!, context: null } : null);
  const [contactIds, setContactIds] = useState(initial.contactIds);
  const [knownContacts, setKnownContacts] = useState<ContactOption[]>(options.contacts);
  function selectAccount(item: PickerResult | null) {
    if (item?.id === account?.id) return;
    setAccount(item);
    if (!item || !opportunity?.accountIds?.includes(item.id)) setOpportunity(null);
    if (!item || !project?.accountIds?.includes(item.id)) setProject(null);
    setContactIds(old => old.filter(id => { const contact = knownContacts.find(row => row.id === id); return !!item && !!contact && (contact.accountId === null || contact.accountId === item.id); }));
  }
  return <RecoverableActionForm action={saveCalendarSelection} className="panel grid gap-4 p-5 sm:grid-cols-2"><input type="hidden" name="eventId" value={eventId}/>
    <EntityPicker type="account" label="Account" name="accountId" value={account} onChange={selectAccount}/>
    <EntityPicker type="opportunity" label="Opportunity" name="opportunityId" value={opportunity} filters={{ accountId: account?.id }} disabled={!account} onChange={item => { setOpportunity(item); if (project && item && !project.opportunityIds?.includes(item.id)) setProject(null); }}/>
    <EntityPicker type="project" label="Project" name="projectId" value={project} filters={{ accountId: account?.id, opportunityId: opportunity?.id }} disabled={!account} onChange={setProject}/>
    <ActivityContactPicker contacts={knownContacts} selectedIds={contactIds} onChange={setContactIds} onFound={contact => setKnownContacts(old => old.some(row => row.id === contact.id) ? old : [...old, contact])} accountId={account?.id ?? 0}/>
    <div className="sm:col-span-2"><button className="btn-primary">Save match</button></div>
  </RecoverableActionForm>;
}
