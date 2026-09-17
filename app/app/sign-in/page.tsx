import { signIn } from '@/auth';

export default function SignInPage() {
  return <main className="flex min-h-screen items-center justify-center px-5 py-10">
    <div className="panel w-full max-w-md p-7 shadow-sm sm:p-10">
      <div className="mb-9 text-center">
        {/* The public asset is served directly so the browser requests the PNG URL. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/bixolon-logo.png" alt="BIXOLON" width={500} height={40} className="mx-auto block h-auto w-full max-w-[320px]" />
        <p className="mt-3 text-xs font-semibold uppercase tracking-widest text-slate-500">America CRM</p>
      </div>

      <h1 className="text-3xl font-semibold tracking-tight text-slate-950">Sign in</h1>
      <p className="mt-2 text-base text-slate-600">BIXOLON America Sales CRM</p>
      <p className="mt-6 text-sm text-slate-600">Use your approved BIXOLON corporate account.</p>

      <form className="mt-6" action={async () => { 'use server'; await signIn('google', { redirectTo: '/' }); }}>
        <button type="submit" className="flex w-full items-center justify-center gap-3 rounded-md border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-800 shadow-sm transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600">
          <svg aria-hidden="true" className="h-5 w-5 shrink-0" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path fill="#4285F4" d="M21.35 12.2c0-.73-.06-1.42-.19-2.1H12v3.97h5.24a4.48 4.48 0 0 1-1.94 2.94v2.44h3.14c1.84-1.7 2.91-4.2 2.91-7.25Z"/>
            <path fill="#34A853" d="M12 21.7c2.62 0 4.83-.87 6.44-2.25l-3.14-2.44c-.87.58-1.98.92-3.3.92-2.54 0-4.69-1.72-5.46-4.03H3.3v2.52A9.7 9.7 0 0 0 12 21.7Z"/>
            <path fill="#FBBC05" d="M6.54 13.9A5.83 5.83 0 0 1 6.24 12c0-.66.11-1.3.3-1.9V7.58H3.3A9.7 9.7 0 0 0 2.3 12c0 1.56.37 3.03 1 4.42l3.24-2.52Z"/>
            <path fill="#EA4335" d="M12 6.07c1.42 0 2.69.49 3.69 1.45l2.77-2.77A9.28 9.28 0 0 0 12 2.3a9.7 9.7 0 0 0-8.7 5.28l3.24 2.52C7.31 7.79 9.46 6.07 12 6.07Z"/>
          </svg>
          <span>Sign in with your Google account</span>
        </button>
      </form>
    </div>
  </main>;
}
