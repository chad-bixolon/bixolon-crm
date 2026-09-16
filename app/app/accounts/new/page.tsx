import { Content, PageHeader } from "@/components/shell";
import { AccountForm } from "@/components/account-form";
import { accountOptions } from "@/lib/accounts";
import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";
export default async function NewAccountPage() { const options = await accountOptions(prisma); return <Content><PageHeader eyebrow="Accounts" title="New account" description="Add an organization to the CRM."/><AccountForm {...options}/></Content>; }
