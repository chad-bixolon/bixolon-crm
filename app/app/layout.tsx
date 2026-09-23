import type { Metadata } from "next";
import { auth } from "@/auth";
import { Shell } from "@/components/shell";
import { can } from "@/lib/authorization";
import { getLabels } from "@/lib/configuration";
import { prisma } from "@/lib/prisma";
import { canAccessReports } from "@/lib/reporting";
import "./globals.css";
export const metadata: Metadata = { title: "BIXOLON SalesHub", description: "BIXOLON America internal CRM" };
export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const session = await auth();
  const user = session?.crmUser;
  const labels = user ? await getLabels(prisma) : undefined;
  return <html lang="en"><body><Shell user={user ? { name: user.name, role: user.role, canManageUsers: can(user, 'users.manage'), canViewReports: canAccessReports(user), canViewMarketing:can(user,'marketing.read') } : null} labels={labels}>{children}</Shell></body></html>;
}
