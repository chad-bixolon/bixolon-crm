import { Content, PageHeader } from '@/components/shell';
export default async function AccessDenied({ searchParams }: { searchParams: Promise<{ reason?: string }> }) {
  const { reason } = await searchParams;
  const message = reason === 'inactive' ? 'Your CRM user is inactive or archived. Contact a CRM administrator.' : reason === 'unapproved' ? 'Your Google account does not match an approved CRM user. Contact a CRM administrator.' : reason === 'workspace' ? 'Use your BIXOLON Workspace account. If this is your Workspace account, contact an administrator to check the CRM configuration.' : reason === 'invalid' ? 'Google did not provide a valid, verified identity. Sign in with your BIXOLON Workspace account.' : 'You do not have permission to access this page.';
  return <Content><PageHeader title="Access denied" description={message}/></Content>;
}
