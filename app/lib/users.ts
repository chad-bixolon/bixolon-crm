import { Prisma, UserRole, type PrismaClient } from "@prisma/client";
import { field, required, type Errors } from "./crm-validation";
export { unlinkGoogleIdentity } from "./identity";
export type UserInput = { firstName: string; lastName: string; email: string; role: UserRole; active: boolean };
export function parseUser(form: FormData) {
  const errors: Errors = {};
  const firstName = required(form, "firstName", "First name", 100, errors);
  const lastName = required(form, "lastName", "Last name", 100, errors);
  const email = field(form, "email").toLowerCase();
  if (!email || email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = "Enter a valid email address.";
  const roleRaw = field(form, "role");
  if (!Object.values(UserRole).includes(roleRaw as UserRole)) errors.role = "Choose a valid role.";
  const activeRaw = field(form, "active");
  if (!["true", "false"].includes(activeRaw)) errors.active = "Choose a valid status.";
  return { errors, value: Object.keys(errors).length ? undefined : { firstName, lastName, email, role: roleRaw as UserRole, active: activeRaw === "true" } satisfies UserInput };
}
export async function saveUser(client: PrismaClient, input: UserInput, id?: number) {
  try {
    if (id) {
      const existing = await client.user.findUnique({ where: { id } });
      if (!existing || existing.archivedAt) throw new Error("User not found.");
      return (await client.user.update({ where: { id }, data: input })).id;
    }
    return (await client.user.create({ data: input })).id;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new Error("That email address is already in use.");
    throw error;
  }
}
