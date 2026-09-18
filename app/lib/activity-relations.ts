export type RelatedOption = { id: number; name: string; accountIds: number[] };
export type ContactOption = { id: number; name: string; accountId: number | null; active: boolean };

export function activityChoices(accountId: number, originalAccountId: number, opportunities: RelatedOption[], projects: RelatedOption[], contacts: ContactOption[], historical: { opportunityId?: number; projectId?: number; contactIds: number[] }) {
  const sameAccount = accountId > 0 && accountId === originalAccountId;
  return {
    opportunities: opportunities.filter(item => accountId > 0 && (item.accountIds.includes(accountId) || (sameAccount && item.id === historical.opportunityId))),
    projects: projects.filter(item => accountId > 0 && (item.accountIds.includes(accountId) || (sameAccount && item.id === historical.projectId))),
    contacts: contacts.filter(item => accountId > 0 && ((item.active && (item.accountId === accountId || item.accountId === null)) || (sameAccount && historical.contactIds.includes(item.id)))),
  };
}

export function retainedActivitySelections(accountId: number, originalAccountId: number, opportunities: RelatedOption[], projects: RelatedOption[], contacts: ContactOption[], historical: { opportunityId?: number; projectId?: number; contactIds: number[] }, selected: { opportunityId: number; projectId: number; contactIds: number[] }) {
  const choices = activityChoices(accountId, originalAccountId, opportunities, projects, contacts, historical);
  return {
    opportunityId: choices.opportunities.some(item => item.id === selected.opportunityId) ? selected.opportunityId : 0,
    projectId: choices.projects.some(item => item.id === selected.projectId) ? selected.projectId : 0,
    contactIds: selected.contactIds.filter(id => choices.contacts.some(item => item.id === id)),
  };
}
