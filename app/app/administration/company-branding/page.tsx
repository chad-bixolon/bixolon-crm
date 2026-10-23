import Link from 'next/link';
import { Content, PageHeader } from '@/components/shell';
import { requirePermission } from '@/lib/current-user';
import { getBranding } from '@/lib/deployment-branding';
import { prisma } from '@/lib/prisma';
import { BrandingForm } from './branding-form';
import { LogoForm } from './logo-form';
import { NAV_CATEGORIES } from '@/lib/navigation-categories';

export const dynamic = 'force-dynamic';
export default async function CompanyBrandingPage() {
  await requirePermission('deployment.manage');
  const branding = await getBranding(prisma);
  return <Content><PageHeader eyebrow={NAV_CATEGORIES.administration} title="Company & Branding" description="Set the company and product names shown in the application." action={<Link className="btn-secondary" href="/administration">Administration</Link>}/><BrandingForm companyName={branding.companyName} productName={branding.productName}/><LogoForm hasCustomLogo={!!branding.logoStorageKey} companyName={branding.companyName}/></Content>;
}
