import { Content, PageHeader } from "@/components/shell";
import { AccountForm } from "@/components/account-form";
import { accountOptions } from "@/lib/accounts";
import { prisma } from "@/lib/prisma";
import { getLabels } from "@/lib/configuration";
import { currentUser } from "@/lib/current-user";
import { defaultEligibleUserId } from "@/lib/assignment-eligibility";
export const dynamic = "force-dynamic";
export default async function NewAccountPage() { const [options, labels, actor] = await Promise.all([accountOptions(prisma), getLabels(prisma), currentUser()]); return <Content><PageHeader eyebrow="Accounts" title="New account" description="Add an organization to the CRM."/><AccountForm {...options} labels={labels} defaultOwnerId={defaultEligibleUserId(options.owners, actor.id)}/></Content>; }
