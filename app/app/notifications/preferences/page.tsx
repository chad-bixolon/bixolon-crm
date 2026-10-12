import Link from 'next/link';
import { Content, PageHeader } from '@/components/shell';
import { currentUser } from '@/lib/current-user';
import { prisma } from '@/lib/prisma';
import { preferenceCategories } from '@/lib/notification-preferences';
import { NotificationPreferencesForm } from './preferences-form';

export default async function NotificationPreferencesPage() {
  const actor = await currentUser();
  const rows = await prisma.notificationPreference.findMany({ where: { userId: actor.id }, select: { category: true, enabled: true } });
  const choices = new Map(rows.map(row => [row.category, row.enabled]));
  const initial = Object.fromEntries(preferenceCategories.map(category => [category, choices.get(category) ?? true])) as Record<typeof preferenceCategories[number], boolean>;
  return <Content><PageHeader eyebrow="Notifications" title="Notification preferences" description="Choose which notifications you want SalesHub to surface." action={<Link className="btn-secondary" href="/notifications">Back to notifications</Link>}/>
    <NotificationPreferencesForm initial={initial}/>
    <p className="mt-4 max-w-2xl text-sm text-slate-600">Turning a category off hides its Info and Warning notifications. Critical alerts always remain enabled. Re-enabling a category restores any unresolved notifications.</p>
  </Content>;
}
