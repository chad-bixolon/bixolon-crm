import { NAV_CATEGORIES } from '../../../../../lib/navigation-categories';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Content, PageHeader } from '@/components/shell';
import { CampaignForm } from '@/components/campaign-form';
import { currentUser } from '@/lib/current-user';
import { canManageAttribution } from '@/lib/marketing-attribution';
import { prisma } from '@/lib/prisma';
import { getModuleAvailability } from '@/lib/module-availability';

export default async function EditCampaignPage({ params }: { params: Promise<{ id: string }> }) {
  if (!canManageAttribution(await currentUser())) notFound();
  const id = Number((await params).id); if (!Number.isSafeInteger(id) || id < 1) notFound();
  const campaign = await prisma.marketingCampaign.findUnique({ where: { id } }); if (!campaign) notFound();
  if (campaign.tradeShowId && !(await getModuleAvailability()).effective.has('TRADE_SHOWS')) notFound();
  return <Content><PageHeader eyebrow={NAV_CATEGORIES.marketing} title={`Edit ${campaign.name}`} action={<Link className="btn-secondary" href={`/marketing/campaigns/${id}`}>Campaign Detail</Link>}/><CampaignForm campaign={campaign}/></Content>;
}
