import { userTimeZoneOptions } from "@/lib/user-time-zone";
import { NAV_CATEGORIES } from '../../../../lib/navigation-categories';
import { Content, PageHeader } from "@/components/shell";
import { UserForm } from "@/components/user-form";
import { requirePermission } from "@/lib/current-user";
export default async function NewUserPage() { const actor = await requirePermission("users.manage"); return <Content><PageHeader eyebrow={NAV_CATEGORIES.administration} title="New user"/><UserForm timeZoneOptions={userTimeZoneOptions()} trueAdmin={actor.role === "ADMIN"}/></Content>; }
