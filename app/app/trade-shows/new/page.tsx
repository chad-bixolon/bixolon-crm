import { listEligibleUserOptions } from '@/lib/assignment-eligibility';
import { NAV_CATEGORIES } from '../../../lib/navigation-categories';
import { Content, PageHeader } from '@/components/shell';
import { TradeShowForm } from '@/components/trade-show-form';
import { prisma } from '@/lib/prisma';
import { requirePermission } from '@/lib/current-user';
import { defaultEligibleUserId } from '@/lib/assignment-eligibility';

export const dynamic = 'force-dynamic';
export default async function NewTradeShowPage() {
  const actor = await requirePermission('trade-shows.manage');
  const owners = await listEligibleUserOptions(prisma, 'marketing-owner');
  return <Content><PageHeader eyebrow={NAV_CATEGORIES.marketing} title="New Trade Show"/><TradeShowForm owners={owners} defaultOwnerId={defaultEligibleUserId(owners, actor.id)}/></Content>;
}
