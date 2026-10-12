import Link from 'next/link';
import { Content, PageHeader } from '@/components/shell';
import { currentUser } from '@/lib/current-user';
import { prisma } from '@/lib/prisma';
import { preferenceCategories } from '@/lib/notification-preferences';
import { saveNotificationPreference } from '../actions';

const labels = { TASK: 'Tasks', OPPORTUNITY: 'Opportunities', PRICE_EXCEPTION: 'Price Exceptions', SUPPORT_CASE: 'Support' };
export default async function NotificationPreferencesPage() {
  const actor = await currentUser();
  const rows = await prisma.notificationPreference.findMany({ where: { userId: actor.id }, select: { category: true, enabled: true } });
  const choices = new Map(rows.map(row => [row.category, row.enabled]));
  return <Content><PageHeader eyebrow="Notifications" title="Notification preferences" description="Choose the in-app categories you want in your attention queue." action={<Link className="btn-secondary" href="/notifications">Back to notifications</Link>}/>
    <div className="panel max-w-2xl divide-y divide-slate-100">{preferenceCategories.map(category => <form key={category} action={saveNotificationPreference} className="flex flex-wrap items-center justify-between gap-3 p-4"><input type="hidden" name="category" value={category}/><label className="flex items-center gap-3 text-sm font-medium"><input type="checkbox" name="enabled" defaultChecked={choices.get(category) ?? true} className="h-5 w-5 accent-orange-700"/>{labels[category]}</label><button className="btn-secondary" type="submit">Save</button></form>)}</div>
    <p className="mt-4 max-w-2xl text-sm text-slate-600">Existing categories stay enabled until you turn them off. Critical operational alerts remain on. Turning a category off hides its Info and Warning notices from Active and the bell. Still-relevant notices return when you turn it back on.</p>
  </Content>;
}
