import Link from "next/link";
import { createAccount } from "../actions";

export default function NewAccountPage() {
  return (
    <main className="min-h-screen bg-slate-50 p-8">
      <div className="mx-auto max-w-3xl">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-orange-600">
              BIXOLON CRM
            </p>
            <h1 className="text-3xl font-bold text-slate-900">
              New Account
            </h1>
          </div>

          <Link
            href="/accounts"
            className="text-sm font-medium text-slate-600 hover:text-slate-900"
          >
            Back to Accounts
          </Link>
        </div>

        <form
          action={createAccount}
          className="rounded-xl border border-slate-200 bg-white p-8 shadow-sm"
        >
          <div className="grid gap-6 md:grid-cols-2">

            <div className="md:col-span-2">
              <label className="mb-2 block text-sm font-medium text-slate-700">
                Account Name *
              </label>

              <input
                name="name"
                required
                className="w-full rounded-lg border border-slate-300 px-4 py-3 text-slate-900 outline-none focus:border-orange-500"
                placeholder="Amazon Inc."
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">
                Account Type
              </label>

              <select
                name="accountType"
                className="w-full rounded-lg border border-slate-300 px-4 py-3 text-slate-900"
              >
                <option value="">Select...</option>
                <option value="END_USER">End User</option>
                <option value="DISTRIBUTOR">Distributor</option>
                <option value="VAR">VAR</option>
                <option value="ISV">ISV</option>
                <option value="OEM">OEM</option>
                <option value="PARTNER">Partner</option>
              </select>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">
                Territory
              </label>

              <input
                name="territory"
                className="w-full rounded-lg border border-slate-300 px-4 py-3 text-slate-900"
                placeholder="Northeast"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">
                Industry
              </label>

              <input
                name="industry"
                className="w-full rounded-lg border border-slate-300 px-4 py-3 text-slate-900"
                placeholder="Retail"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">
                Phone
              </label>

              <input
                name="phone"
                className="w-full rounded-lg border border-slate-300 px-4 py-3 text-slate-900"
                placeholder="555-555-5555"
              />
            </div>

            <div className="md:col-span-2">
              <label className="mb-2 block text-sm font-medium text-slate-700">
                Website
              </label>

              <input
                name="website"
                className="w-full rounded-lg border border-slate-300 px-4 py-3 text-slate-900"
                placeholder="https://example.com"
              />
            </div>
          </div>

          <div className="mt-8 flex justify-end gap-3">
            <Link
              href="/accounts"
              className="rounded-lg border border-slate-300 px-5 py-3 font-medium text-slate-700"
            >
              Cancel
            </Link>

            <button
              type="submit"
              className="rounded-lg bg-orange-600 px-5 py-3 font-semibold text-white hover:bg-orange-700"
            >
              Create Account
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}
