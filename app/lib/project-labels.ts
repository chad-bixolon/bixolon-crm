import { ProjectPartyRole, ProjectStatus } from '@prisma/client';

export const projectRoleLabels: Record<ProjectPartyRole, string> = {
  PROGRAM_OWNER: 'Program Owner', END_CUSTOMER: 'End Customer', DISTRIBUTOR: 'Distributor',
  VAR_RESELLER: 'VAR / Reseller', INTEGRATOR: 'Integrator', ISV: 'ISV', OEM: 'OEM',
  SERVICE_PROVIDER: 'Service Provider', CONNECTIVITY_PROVIDER: 'Connectivity Provider',
  IMPLEMENTATION_PARTNER: 'Implementation Partner', OTHER: 'Other',
};
export const projectStatusLabels: Record<ProjectStatus, string> = {
  PLANNING: 'Planning', ACTIVE: 'Active', ON_HOLD: 'On Hold', COMPLETED: 'Completed', CANCELLED: 'Cancelled',
};
