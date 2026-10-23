import { Content, PageHeader } from '@/components/shell';
import { HelpDirectory } from '@/components/help-directory';
import { currentUser } from '@/lib/current-user';
import { helpGroups, visibleHelpTopics } from '@/lib/help/topics';
import { getBranding } from '@/lib/deployment-branding';
import { prisma } from '@/lib/prisma';

export default async function HelpPage() {
  const branding = await getBranding(prisma);
  const topics = visibleHelpTopics(await currentUser(), branding.productName);
  return <Content><PageHeader eyebrow="Help & Onboarding" title={`Your ${branding.productName} guide`} description="Practical guidance for customer work, follow-ups, and team reviews."/>
    <HelpDirectory groups={helpGroups} topics={topics.map(({ id, title, summary, group, sections }) => ({ id, title, summary, group, searchText: [title, summary, ...sections.flatMap(section => [section.heading, ...section.paragraphs])].join(' ').toLocaleLowerCase() }))}/>
  </Content>;
}
