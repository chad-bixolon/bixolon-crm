import Link from 'next/link';
import { Content, PageHeader } from '@/components/shell';
import { currentUser } from '@/lib/current-user';

export default async function ModuleUnavailablePage() {
  await currentUser();
  return <Content><PageHeader title="Module unavailable" description="This module is currently unavailable in this SalesHub deployment."/><Link className="btn-primary" href="/">Return to Dashboard</Link></Content>;
}
