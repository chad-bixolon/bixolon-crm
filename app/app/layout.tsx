import type { Metadata } from "next";
import { auth } from "@/auth";
import { Shell } from "@/components/shell";
import { can } from "@/lib/authorization";
import "./globals.css";
export const metadata: Metadata = { title: "BIXOLON America CRM", description: "BIXOLON America internal CRM" };
export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const session = await auth();
  const user = session?.crmUser;
  return <html lang="en"><body><Shell user={user ? { name: user.name, role: user.role, canManageUsers: can(user, 'users.manage') } : null}>{children}</Shell></body></html>;
}
