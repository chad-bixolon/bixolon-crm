import { Content, PageHeader } from '@/components/shell';
import { HelpDirectory } from '@/components/help-directory';
import { currentUser } from '@/lib/current-user';
import { helpGroups, visibleHelpTopics } from '@/lib/help/topics';

export default async function HelpPage() {
  const topics = visibleHelpTopics(await currentUser());
  return <Content><PageHeader eyebrow="Help & Onboarding" title="Your SalesHub guide" description="Practical guidance for customer work, follow-ups, and team reviews."/>
    <HelpDirectory groups={helpGroups} topics={topics.map(({ id, title, summary, group, sections }) => ({ id, title, summary, group, searchText: [title, summary, ...sections.flatMap(section => [section.heading, ...section.paragraphs])].join(' ').toLocaleLowerCase() }))}/>
  </Content>;
}
