'use client';
import { useState } from 'react';
import { RecoverableActionForm } from '@/components/recoverable-action-form';
import { saveCalendarSelection } from '@/app/calendar-matches/actions';
import { ImportSearchPicker } from './import-search-picker';
import { ActivityContactPicker } from './activity-contact-picker';
import { activityChoices } from '@/lib/activity-relations';
import type { workOptions } from '@/lib/work-options';

type Options = Awaited<ReturnType<typeof workOptions>>;
export function CalendarMatchForm({ eventId, options, initial }: { eventId: number; options: Options; initial: { accountId: number | null; contactIds: number[]; opportunityId: number | null; projectId: number | null } }) {
  const [accountId, setAccountId] = useState(initial.accountId);
  const [contactIds, setContactIds] = useState(initial.contactIds);
  const [opportunityId, setOpportunityId] = useState(initial.opportunityId);
  const [projectId, setProjectId] = useState(initial.projectId);
  const choices = activityChoices(accountId ?? 0, initial.accountId ?? 0, options.opportunities, options.projects, options.contacts, { opportunityId: initial.opportunityId ?? 0, projectId: initial.projectId ?? 0, contactIds: initial.contactIds }, { opportunityId: opportunityId ?? 0, projectId: projectId ?? 0 });
  const projects = opportunityId ? choices.projects.filter(p => p.opportunityIds?.includes(opportunityId)) : choices.projects;
  function selectAccount(value: number | null) { setAccountId(value); setContactIds([]); setOpportunityId(null); setProjectId(null); }
  return <RecoverableActionForm action={saveCalendarSelection} className="panel grid gap-4 p-5 sm:grid-cols-2"><input type="hidden" name="eventId" value={eventId}/><div><label className="label">Account</label><ImportSearchPicker label="Account" items={options.accounts} value={accountId} onChange={selectAccount} emptyLabel="Unresolved"/><input type="hidden" name="accountId" value={accountId ?? ''}/></div><div><label className="label">Opportunity</label><ImportSearchPicker label="Opportunity" items={choices.opportunities} value={opportunityId} onChange={value => { setOpportunityId(value); setProjectId(null); }} emptyLabel="None"/><input type="hidden" name="opportunityId" value={opportunityId ?? ''}/></div><div><label className="label">Project</label><ImportSearchPicker label="Project" items={projects} value={projectId} onChange={setProjectId} emptyLabel="None"/><input type="hidden" name="projectId" value={projectId ?? ''}/></div><ActivityContactPicker contacts={choices.contacts} selectedIds={contactIds} onChange={setContactIds} accountSelected={!!accountId}/><div className="sm:col-span-2"><button className="btn-primary">Save match</button></div></RecoverableActionForm>;
}
