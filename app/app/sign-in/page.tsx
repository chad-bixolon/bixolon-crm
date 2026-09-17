import { signIn } from '@/auth';
import { Content, PageHeader } from '@/components/shell';
export default function SignInPage() {
  return <Content><PageHeader title="Sign in" description="Use your approved BIXOLON Google Workspace account."/><form action={async () => { 'use server'; await signIn('google', { redirectTo: '/' }); }}><button className="btn-primary">Sign in with Google</button></form></Content>;
}
