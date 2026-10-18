import { companyCurrency } from "@/lib/company-currency";
import { CurrencyProvider } from "@/components/currency-control";
import type { Metadata } from "next";
import { userContext } from "@/lib/current-user";
import { impersonationAdminAllowed } from "@/lib/dev-impersonation";
import { Shell } from "@/components/shell";
import { can } from "@/lib/authorization";
import { getLabels } from "@/lib/configuration";
import { prisma } from "@/lib/prisma";
import { canAccessReports } from "@/lib/reporting";
import { notificationSummary } from "@/lib/notifications";
import "./globals.css";
export const metadata: Metadata = { title: "BIXOLON SalesHub", description: "BIXOLON America internal CRM" };
export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const context = await userContext();
  const user = context.effective;
  const currencyConfig = user ? await companyCurrency() : null;
  const labels = user ? await getLabels(prisma) : undefined;
  const notifications = user ? await notificationSummary(prisma, user) : null;
  return <html lang="en"><body><Shell user={user ? { id: user.id, name: user.name, role: user.role, canManageUsers: can(user, 'users.manage'), canViewReports: canAccessReports(user)||can(user,'support-cases.read'), canViewMarketing:can(user,'marketing.read'), canViewSales:can(user,'sales.read'), canViewOpportunities:can(user,'opportunities.read'), canViewSupport:can(user,'support-cases.read') && can(user,'accounts.read'), canCreateAccount:can(user,'accounts.write'), canCreateContact:can(user,'contacts.write'), canCreateOpportunity:can(user,'sales.write'), canCreateTask:can(user,'tasks.write') } : null} notifications={notifications} developmentAdmin={impersonationAdminAllowed(context.real) && !context.impersonating} impersonating={context.impersonating ? { realName: context.real!.name, effectiveName: user!.name, role: user!.role } : null} labels={labels}>{currencyConfig ? <CurrencyProvider configuration={currencyConfig}>{children}</CurrencyProvider> : children}</Shell></body></html>;
}
