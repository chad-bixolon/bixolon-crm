import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Content, PageHeader } from '@/components/shell';
import { CampaignForm } from '@/components/campaign-form';
import { currentUser } from '@/lib/current-user';
import { canManageAttribution } from '@/lib/marketing-attribution';

export default async function NewCampaignPage() {
  if (!canManageAttribution(await currentUser())) notFound();
  return <Content><PageHeader eyebrow="Campaigns" title="New Campaign" action={<Link className="btn-secondary" href="/marketing/campaigns">All Campaigns</Link>}/><CampaignForm/></Content>;
}
