import { notFound } from "next/navigation";
import { Content, PageHeader } from "@/components/shell";
import { AccountForm } from "@/components/account-form";
import { accountOptions } from "@/lib/accounts";
import { prisma } from "@/lib/prisma";
import { getLabels } from "@/lib/configuration";
export const dynamic = "force-dynamic";
export default async function EditAccountPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id); if (!Number.isSafeInteger(id) || id <= 0) notFound();
  const [account, options, labels] = await Promise.all([prisma.account.findUnique({ where: { id }, include: { businessRoles: true, industryCategory: true, territoryCategory: true } }), accountOptions(prisma), getLabels(prisma)]);
  if (!account) notFound();
  if (account.status === "ARCHIVED") return <Content><PageHeader eyebrow="Accounts" title={account.name}/><div className="panel p-6 text-sm text-slate-600">Reactivate this account before editing it.</div></Content>;
  const industries = account.industryCategory && !options.industries.some((item) => item.code === account.industry) ? [...options.industries, account.industryCategory] : options.industries;
  const territories = account.territoryCategory && !options.territories.some((item) => item.code === account.territory) ? [...options.territories, account.territoryCategory] : options.territories;
  return <Content><PageHeader eyebrow="Accounts" title={`Edit ${account.name}`} description="Update account profile and classifications."/><AccountForm id={id} initial={{ ...account, roles: account.businessRoles.map((r) => r.role) }} {...options} industries={industries} territories={territories} labels={labels}/></Content>;
}
