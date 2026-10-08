export function contactDisplayName(contact: { firstName?: string | null; lastName?: string | null; email?: string | null } | null | undefined): string {
  const name = [contact?.firstName, contact?.lastName].filter(Boolean).join(' ').trim();
  return name || contact?.email?.trim() || 'Contact';
}

export function contactDisplayContext(contact: { account?: { name: string } | null; email?: string | null; title?: string | null }): string | undefined {
  return [contact.account?.name, contact.email, contact.title].filter(Boolean).join(' · ') || undefined;
}
