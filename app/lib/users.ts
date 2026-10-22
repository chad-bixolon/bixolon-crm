import { Prisma, UserRole, type PrismaClient } from "@prisma/client";
import { field, required, type Errors } from "./crm-validation";
import { assertPermission, type Actor } from "./authorization";
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
export const lastAdminMessage = "Keep at least one active, unarchived Administrator. Activate another Administrator before changing this user.";

/** All user administration writes serialize, then recheck the persisted actor.
 * The transaction lock prevents two Admins concurrently removing the last pair.
 * No app archive/delete path exists for User; future paths must use this guard.
 */
export async function assertUsableAdminRemains(tx: Prisma.TransactionClient, id: number, next: { role: UserRole; active: boolean; archivedAt?: Date | null }) {
  if (next.role === 'ADMIN' && next.active && !next.archivedAt) return;
  const existing = await tx.user.findUnique({ where: { id } });
  if (existing?.role === 'ADMIN' && existing.active && !existing.archivedAt &&
      !await tx.user.count({ where: { id: { not: id }, role: 'ADMIN', active: true, archivedAt: null } })) throw new Error(lastAdminMessage);
}

export async function saveUser(client: PrismaClient, actor: Actor, input: UserInput, id?: number) {
  assertPermission(actor, 'users.manage');
  // Whitelist fields at the service boundary as well as validating form input.
  const form = new FormData();
  for (const key of ['firstName', 'lastName', 'email', 'role', 'active'] as const) form.set(key, String(input[key]));
  const parsed = parseUser(form);
  if (!parsed.value) throw new Error('Invalid user fields.');
  const value = parsed.value;
  try {
    return await client.$transaction(async tx => {
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(72341001)`;
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${actor.id} FOR UPDATE`;
      const persistedActor = await tx.user.findUnique({ where: { id: actor.id } });
      assertPermission(persistedActor, 'users.manage');
      if (id) {
        const existing = await tx.user.findUnique({ where: { id } });
        if (!existing || existing.archivedAt) throw new Error("User not found.");
        await assertUsableAdminRemains(tx, id, value);
        return (await tx.user.update({ where: { id }, data: value })).id;
      }
      return (await tx.user.create({ data: value })).id;
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new Error("That email address is already in use.");
    throw error;
  }
}
