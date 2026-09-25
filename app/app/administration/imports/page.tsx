import Link from 'next/link';
import { Content, PageHeader } from '@/components/shell';
import { requirePermission } from '@/lib/current-user';

const workflows = [
  {
    title: 'Accounts & Contacts',
    href: '/administration/imports/accounts-contacts',
    description: 'Upload and review Account and Contact records before applying changes.',
  },
  {
    title: 'Products & Pricing',
    href: '/administration/imports/products',
    description: 'Upload and review Products, part numbers, and prices before applying changes.',
  },
  {
    title: 'Price Exceptions · CSV',
    href: '/administration/imports/price-exceptions/rosa',
    description: 'Preview and validate a Price Exception CSV before importing ready records.',
  },
  {
    title: 'Price Exceptions · Legacy Workbook',
    href: '/administration/imports/price-exceptions',
    description: 'Historical XLSX workflow for finalized Distributor Price Exceptions.',
  },
] as const;

export default async function ImportsPage() {
  await requirePermission('users.manage');
  return <Content>
    <PageHeader eyebrow="Administration" title="Imports" description="Choose the records you want to import." action={<Link className="btn-secondary" href="/administration">Administration</Link>}/>
    <div className="grid gap-5 md:grid-cols-2">
      {workflows.map(({ title, href, description }) => <Link className="panel block p-6 hover:border-orange-300 hover:bg-orange-50" href={href} key={href}>
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="mt-2 text-sm text-slate-600">{description}</p>
        <span className="mt-4 inline-block text-sm font-semibold text-orange-800">Open →</span>
      </Link>)}
    </div>
  </Content>;
}
