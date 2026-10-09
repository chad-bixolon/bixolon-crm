import { prisma } from '@/lib/prisma';
import { opportunityScope, type Actor } from '@/lib/authorization';
import { projectReadWhere } from '@/lib/projects';
import { EntityPicker } from './entity-picker';
import type { EntitySearchFilters, EntityType } from '@/lib/entity-search';

export async function ReportEntityFilter({ type, name, label, selected, actor, filters }: { type: EntityType; name: string; label: string; selected: string; actor: Actor; filters?: EntitySearchFilters }) {
  const id = Number(selected);
  const valid = Number.isSafeInteger(id) && id > 0;
  const row = !valid ? null : type === 'account' ? await prisma.account.findUnique({ where: { id }, select: { id: true, name: true } })
    : type === 'contact' ? await prisma.contact.findUnique({ where: { id }, select: { id: true, firstName: true, lastName: true } }).then(item => item && ({ id: item.id, name: `${item.firstName} ${item.lastName}` }))
    : type === 'opportunity' ? await prisma.opportunity.findFirst({ where: { id, ...opportunityScope(actor) }, select: { id: true, name: true } })
    : await prisma.project.findFirst({ where: { AND: [{ id }, projectReadWhere(actor)] }, select: { id: true, name: true } });
  return <EntityPicker type={type} name={name} label={label} initial={row ? { ...row, context: null } : null} filters={filters}/>;
}
