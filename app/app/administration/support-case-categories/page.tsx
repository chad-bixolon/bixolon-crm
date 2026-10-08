import Link from 'next/link';
import { NAV_CATEGORIES } from '@/lib/navigation-categories';
import { Content, PageHeader } from '@/components/shell';
import { SupportCategoryForm } from '@/components/support-category-form';
import { requirePermission } from '@/lib/current-user';
import { prisma } from '@/lib/prisma';
import { listSupportCaseCategories } from '@/lib/support-case-categories';
export const dynamic = 'force-dynamic';
export default async function SupportCaseCategoriesPage() {
  const actor = await requirePermission('support-categories.manage');
  const categories = await listSupportCaseCategories(prisma, actor, false);
  return <Content><PageHeader eyebrow={NAV_CATEGORIES.administration} title="Support Case Categories" description="Manage case categories and display order." action={<Link className="btn-secondary" href="/administration">Administration</Link>}/><section className="panel mb-5 p-5"><h2 className="mb-4 text-lg font-semibold">Add category</h2><SupportCategoryForm/></section><section className="panel p-5"><h2 className="mb-2 text-lg font-semibold">Existing categories</h2><p className="mb-4 text-sm text-slate-600">Inactive categories remain on existing cases. Set order to control form choices.</p><div className="space-y-5">{categories.map(category => <div key={category.id} className="border-t border-slate-200 pt-4"><SupportCategoryForm initial={category}/></div>)}{categories.length === 0 && <p className="text-sm text-slate-500">No categories yet.</p>}</div></section></Content>;
}
