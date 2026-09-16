import Link from "next/link";

export default function HomePage() {
  return (
    <main className="min-h-screen bg-slate-50 p-8">
      <div className="mx-auto max-w-7xl">

        <div className="mb-10">
          <p className="text-sm font-semibold text-orange-600">
            BIXOLON America
          </p>

          <h1 className="text-4xl font-bold text-slate-900">
            CRM
          </h1>

          <p className="mt-2 text-slate-500">
            Sales pipeline, customer relationships and account activity.
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-3">

          <Link
            href="/accounts"
            className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-md"
          >
            <div className="text-lg font-bold text-slate-900">
              Accounts
            </div>

            <p className="mt-2 text-sm text-slate-500">
              Customers, distributors, VARs, ISVs and partners.
            </p>
          </Link>

          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="text-lg font-bold text-slate-900">
              Opportunities
            </div>

            <p className="mt-2 text-sm text-slate-500">
              Pipeline and opportunity management coming next.
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="text-lg font-bold text-slate-900">
              Tasks
            </div>

            <p className="mt-2 text-sm text-slate-500">
              Follow-ups and sales activities coming next.
            </p>
          </div>

        </div>
      </div>
    </main>
  );
}
