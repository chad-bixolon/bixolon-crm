import type { UserRole } from "@prisma/client";

export const roleLabels: Record<UserRole, string> = {
  ADMIN: "Administrator",
  SUPPORT: "Support",
  SALES_MANAGER: "Sales Manager",
  SALES: "Sales",
  MARKETING_MANAGER: "Marketing Manager",
  READ_ONLY: "Read Only",
};
