import Link from "next/link";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function AccountsPage() {
  const accounts = await prisma.account.findMany({
    orderBy: {
      name: "asc",
    },
    include: {
      _count: {
        select: {
          contacts: true,
          opportunities: true,
        },
      },
    },
  });

  return (
    <main className="min-h-screen bg-slate-50 p-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-orange-600">
              BIXOLON CRM
            </p>

            <h1 className="text-3xl font-bold text-slate-900">
              Accounts
            </h1>

            <p className="mt-1 text-slate-500">
              Manage customers, partners, distributors, VARs and end users.
            </p>
          </div>

          <Link
            href="/accounts/new"
            className="rounded-lg bg-orange-600 px-5 py-3 font-semibold text-white shadow-sm hover:bg-orange-700"
          >
            New Account
          </Link>
        </div>

        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full">
            <thead className="bg-slate-100 text-left text-sm text-slate-600">
              <tr>
                <th className="px-6 py-4">Account</th>
                <th className="px-6 py-4">Type</th>
                <th className="px-6 py-4">Territory</th>
                <th className="px-6 py-4 text-center">Contacts</th>
                <th className="px-6 py-4 text-center">Opportunities</th>
                <th className="px-6 py-4">Status</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100">
              {accounts.map((account) => (
                <tr
                  key={account.id}
                  className="hover:bg-slate-50"
                >
                  <td className="px-6 py-4">
                    <div className="font-semibold text-slate-900">
                      {account.name}
                    </div>

                    {account.industry && (
                      <div className="text-sm text-slate-500">
                        {account.industry}
                      </div>
                    )}
                  </td>

                  <td className="px-6 py-4 text-slate-600">
                    {account.accountType || "—"}
                  </td>

                  <td className="px-6 py-4 text-slate-600">
                    {account.territory || "—"}
                  </td>

                  <td className="px-6 py-4 text-center text-slate-600">
                    {account._count.contacts}
                  </td>

                  <td className="px-6 py-4 text-center text-slate-600">
                    {account._count.opportunities}
                  </td>

                  <td className="px-6 py-4">
                    <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-semibold text-green-700">
                      {account.status}
                    </span>
                  </td>
                </tr>
              ))}

              {accounts.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    className="px-6 py-16 text-center text-slate-500"
                  >
                    No accounts yet. Create the first account to get started.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
