import Link from 'next/link';
import { helpHref } from '@/lib/help/links';
import type { HelpTopicId } from '@/lib/help/topics';

export function HelpLink({ topic, children = 'Learn more' }: { topic: HelpTopicId; children?: React.ReactNode }) {
  return <Link href={helpHref(topic)} className="inline-flex min-h-11 items-center rounded px-1 text-sm font-medium text-orange-800 underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-orange-600">{children}</Link>;
}
