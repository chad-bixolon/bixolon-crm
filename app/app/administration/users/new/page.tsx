import { NAV_CATEGORIES } from '../../../../lib/navigation-categories';
import { Content, PageHeader } from "@/components/shell";
import { UserForm } from "@/components/user-form";
export default function NewUserPage() { return <Content><PageHeader eyebrow={NAV_CATEGORIES.administration} title="New user"/><UserForm/></Content>; }
