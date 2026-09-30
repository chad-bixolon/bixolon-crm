import type { ContactOption } from './activity-relations';

export function activityContactLabel(contact: ContactOption) {
  return `${contact.name} — ${contact.accountId === null ? 'No Account' : contact.accountName || 'Account unavailable'}`;
}

export function searchActivityContacts(contacts: ContactOption[], query: string, selectedIds: number[]) {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return contacts.filter(contact => !selectedIds.includes(contact.id) && terms.every(term =>
    `${contact.name} ${contact.email ?? ''} ${contact.accountName ?? ''}`.toLocaleLowerCase().includes(term)
  ));
}
