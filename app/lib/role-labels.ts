import type { UserRole } from "@prisma/client";

export const roleLabels: Record<UserRole, string> = {
  SUPPORT_MANAGER: "Support Manager",
  EXECUTIVE: "Executive",
  ADMIN: "Administrator",
  SUPPORT: "Support",
  SALES_MANAGER: "Sales Manager",
  SALES: "Sales",
  MARKETING_MANAGER: "Marketing Manager",
  READ_ONLY: "Read Only",
};

export const roleDescriptions: Record<UserRole, string> = {
 ADMIN: 'Manages CRM configuration and administration.',
 SALES_MANAGER: 'Manages Sales work, team oversight and may own customer business.',
 SALES: 'Manages customer Sales work and assigned opportunities.',
 SUPPORT_MANAGER: 'Support work plus team workload oversight.',
 SUPPORT: 'Resolves customer Support Cases.',
 MARKETING_MANAGER: 'Manages Marketing operations and governance.',
 EXECUTIVE: 'Broad company visibility without routine operational ownership.',
 READ_ONLY: 'Business-record viewing with personal preference actions only.',
};
