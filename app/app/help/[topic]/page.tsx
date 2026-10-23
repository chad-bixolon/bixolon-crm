import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Content, PageHeader } from '@/components/shell';
import { currentUser } from '@/lib/current-user';
import { visibleHelpTopics } from '@/lib/help/topics';
import { getModuleAvailability } from '@/lib/module-availability';
import { helpHref } from '@/lib/help/links';
import { getBranding } from '@/lib/deployment-branding';
import { prisma } from '@/lib/prisma';

export default async function HelpTopicPage({ params }: { params: Promise<{ topic: string }> }) {
  const { topic: id } = await params;
  const branding = await getBranding(prisma);
  const topics = visibleHelpTopics(await currentUser(), branding.productName, await getModuleAvailability());
  const topic = topics.find(topic => topic.id === id);
  if (!topic) notFound();
  const linkClass = 'inline-flex min-h-11 items-center rounded px-1 text-sm font-medium text-orange-800 underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-orange-600';
  return <Content>
    <Link href="/help" className={`${linkClass} mb-3`}>← All Help topics</Link>
    <PageHeader eyebrow={`Help · ${topic.group}`} title={topic.title} description={topic.summary}/>
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,72ch)_minmax(12rem,1fr)]">
      <article aria-label={topic.title} className="panel max-w-[72ch] space-y-8 p-5 sm:p-8">
        <nav aria-label="On this page" className="border-b border-slate-200 pb-5"><h2 className="mb-2 text-sm font-semibold">On this page</h2><ul>{topic.sections.map((section, index) => <li key={section.heading}><a href={`#section-${index + 1}`} className={linkClass}>{section.heading}</a></li>)}</ul></nav>
        {topic.sections.map((section, index) => <section key={section.heading} id={`section-${index + 1}`} className="scroll-mt-6"><h2 className="mb-3 text-lg font-semibold text-slate-950">{section.heading}</h2><div className="space-y-3 text-base leading-7 text-slate-700">{section.paragraphs.map(paragraph => <p key={paragraph}>{paragraph}</p>)}</div></section>)}
      </article>
      <nav aria-label="More Help topics" className="panel p-5"><h2 className="mb-2 font-semibold">More in {topic.group}</h2><ul>{topics.filter(other => other.group === topic.group && other.id !== topic.id).map(other => <li key={other.id}><Link className={linkClass} href={helpHref(other.id)}>{other.title}</Link></li>)}</ul><Link href="/help" className={linkClass}>Browse all topics</Link></nav>
    </div>
  </Content>;
}
