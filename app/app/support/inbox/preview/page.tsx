import { redirect } from 'next/navigation';
export default async function LegacyEmailPreview({ searchParams }: { searchParams: Promise<{ messageId?: string }> }) {
  const { messageId } = await searchParams;
  redirect(`/support/cases/new?emailMessageId=${encodeURIComponent(messageId ?? '')}`);
}
