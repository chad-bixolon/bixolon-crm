import Link from 'next/link';
import { getModuleAvailability, reportTypeAvailable } from '@/lib/module-availability';
import { currentUser } from '@/lib/current-user';
import { canRunReportType } from '@/lib/reporting';

const links = [
  ['PIPELINE', 'Pipeline'],
  ['ACCOUNT_ACTIVITY', 'Account Activity'],
  ['PRODUCT_PERFORMANCE', 'Product Performance'],
  ['CHANNEL_PARTNER', 'Channel / Partner'],
  ['PROJECT_INITIATIVE', 'Project Performance'],
  ['PRICE_EXCEPTION_USAGE', 'Price Exception Usage'],
] as const;

export async function ReportTypeLinks() {
  const [availability, actor] = await Promise.all([getModuleAvailability(), currentUser()]);
  return <div className="mb-2 flex flex-wrap gap-2">{links.filter(([type]) => reportTypeAvailable(type, availability) && canRunReportType(actor, type)).map(([type, label]) =>
    <Link className="btn-secondary" href={`/reports/new?reportType=${type}`} key={type}>{label}</Link>
  )}</div>;
}
