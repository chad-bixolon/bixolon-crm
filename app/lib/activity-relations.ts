export type RelatedOption = { id: number; name: string; accountIds: number[]; projectIds?: number[]; opportunityIds?: number[] };
export type ContactOption = { id: number; name: string; accountId: number | null; active: boolean };

export function activityChoices(accountId: number, originalAccountId: number, opportunities: RelatedOption[], projects: RelatedOption[], contacts: ContactOption[], historical: { opportunityId?: number; projectId?: number; contactIds: number[] }, selected: { opportunityId?: number; projectId?: number } = {}) {
  const sameAccount = accountId > 0 && accountId === originalAccountId;
  const historicalPair = sameAccount && selected.opportunityId === historical.opportunityId && selected.projectId === historical.projectId;
  return {
    opportunities: opportunities.filter(item => accountId > 0 && (item.accountIds.includes(accountId) || (sameAccount && item.id === historical.opportunityId)) && (!selected.projectId || item.projectIds?.includes(selected.projectId) || (historicalPair && item.id === historical.opportunityId))),
    projects: projects.filter(item => accountId > 0 && (item.accountIds.includes(accountId) || (sameAccount && item.id === historical.projectId)) && (!selected.opportunityId || item.opportunityIds?.includes(selected.opportunityId) || (historicalPair && item.id === historical.projectId))),
    contacts: contacts.filter(item => accountId > 0 && ((item.active && (item.accountId === accountId || item.accountId === null)) || (sameAccount && historical.contactIds.includes(item.id)))),
  };
}

export function retainedActivitySelections(accountId: number, originalAccountId: number, opportunities: RelatedOption[], projects: RelatedOption[], contacts: ContactOption[], historical: { opportunityId?: number; projectId?: number; contactIds: number[] }, selected: { opportunityId: number; projectId: number; contactIds: number[] }, changed: 'account' | 'opportunity' | 'project' = 'account') {
  const choices = activityChoices(accountId, originalAccountId, opportunities, projects, contacts, historical);
  let opportunityId = choices.opportunities.some(item => item.id === selected.opportunityId) ? selected.opportunityId : 0;
  let projectId = choices.projects.some(item => item.id === selected.projectId) ? selected.projectId : 0;
  if (changed === 'opportunity' && opportunityId && projectId && !projects.find(item => item.id === projectId)?.opportunityIds?.includes(opportunityId)) projectId = 0;
  if (changed === 'project' && opportunityId && projectId && !opportunities.find(item => item.id === opportunityId)?.projectIds?.includes(projectId)) opportunityId = 0;
  if (changed === 'account' && opportunityId && projectId && !opportunities.find(item => item.id === opportunityId)?.projectIds?.includes(projectId)) projectId = 0;
  return { opportunityId, projectId, contactIds: selected.contactIds.filter(id => choices.contacts.some(item => item.id === id)) };
}
