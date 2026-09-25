import type { Prisma } from '@prisma/client';

// These predicates describe live CRM relationships. Archived records remain
// available through explicit history views, which must not use these filters.
export const operationalAccountWhere: Prisma.AccountWhereInput = { archivedAt: null, status: 'ACTIVE' };
export const operationalProjectWhere: Prisma.ProjectWhereInput = {
  archivedAt: null,
  AND: [
    { OR: [{ primaryAccountId: null }, { primaryAccount: { is: operationalAccountWhere } }] },
    { participants: { none: { account: { OR: [{ archivedAt: { not: null } }, { status: { not: 'ACTIVE' } }] } } } },
  ],
};
export const operationalOpportunityWhere: Prisma.OpportunityWhereInput = {
  archivedAt: null,
  AND: [
    { OR: [{ legacyAccountId: null }, { legacyAccount: { is: operationalAccountWhere } }] },
    { participants: { none: { account: { OR: [{ archivedAt: { not: null } }, { status: { not: 'ACTIVE' } }] } } } },
    { projects: { none: { project: { NOT: operationalProjectWhere } } } },
  ],
};
const operationalParents = [
  { OR: [{ accountId: null }, { account: { is: operationalAccountWhere } }] },
  { OR: [{ projectId: null }, { project: { is: operationalProjectWhere } }] },
  { OR: [{ opportunityId: null }, { opportunity: { is: operationalOpportunityWhere } }] },
];
export const operationalTaskWhere: Prisma.TaskWhereInput = { archivedAt: null, AND: operationalParents };
export const operationalActivityWhere: Prisma.ActivityWhereInput = { archivedAt: null, AND: operationalParents };
export const operationalContactWhere: Prisma.ContactWhereInput = {
  archivedAt: null, active: true,
  OR: [{ accountId: null }, { account: { is: operationalAccountWhere } }],
};
