import Link from "next/link";
import { Content, PageHeader } from "@/components/shell";
export default function AdministrationPage() { return <Content><PageHeader eyebrow="CRM" title="Administration"/><div className="panel p-6"><h2 className="text-lg font-semibold">Users</h2><p className="mt-2 text-sm text-slate-600">Create and manage CRM users for record ownership.</p><Link className="btn-primary mt-4 inline-block" href="/administration/users">Manage users</Link></div></Content>; }
