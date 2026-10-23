import { Prisma, UserRole, type PrismaClient } from "@prisma/client";
import { field, required, type Errors } from "./crm-validation";
import { assertPermission, type Actor } from "./authorization";
import { isUserTimeZone, DEFAULT_USER_TIME_ZONE } from "./user-time-zone";
import { userChangeImpact, impactConfirmation, UserImpactRequired, recordUserHistory, type UserHistoryAction } from "./user-lifecycle";
export { unlinkGoogleIdentity } from "./identity";
export type UserInput = { firstName: string; lastName: string; email: string; role: UserRole; active: boolean; timeZone?: string; delegatedUserAdministrationEnabled?: boolean };
export function parseUser(form: FormData) {
  const errors: Errors = {};
  const firstName = required(form, "firstName", "First name", 100, errors);
  const lastName = required(form, "lastName", "Last name", 100, errors);
  const email = field(form, "email").toLowerCase();
  if (!email || email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = "Enter a valid email address.";
  const roleRaw = field(form, "role");
  if (!Object.values(UserRole).includes(roleRaw as UserRole)) errors.role = "Choose a valid role.";
  const timeZone = field(form, "timeZone") || DEFAULT_USER_TIME_ZONE;
  if (!isUserTimeZone(timeZone)) errors.timeZone = "Choose a valid IANA timezone.";
  const delegation = field(form, "delegatedUserAdministrationEnabled");
  if (delegation && !["true", "false"].includes(delegation)) errors.delegatedUserAdministrationEnabled = "Invalid delegation.";
  const activeRaw = field(form, "active");
  if (!["true", "false"].includes(activeRaw)) errors.active = "Choose a valid status.";
  return { errors, value: Object.keys(errors).length ? undefined : { firstName, lastName, email, role: roleRaw as UserRole, active: activeRaw === "true", timeZone, ...(delegation ? { delegatedUserAdministrationEnabled: delegation === "true" } : {}) } satisfies UserInput };
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

export async function saveUser(client: PrismaClient, actor: Actor, input: UserInput, id?: number, confirmation?: string) {
  assertPermission(actor, 'users.manage');
  // Whitelist fields at the service boundary as well as validating form input.
  const form = new FormData();
  for (const key of ['firstName', 'lastName', 'email', 'role', 'active', 'timeZone', 'delegatedUserAdministrationEnabled'] as const) if (input[key] !== undefined) form.set(key, String(input[key]));
  const parsed = parseUser(form);
  if (!parsed.value) throw new Error('Invalid user fields.');
  const value: UserInput = parsed.value;
  try {
    return await client.$transaction(async tx => {
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(72341001)`;
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${actor.id} FOR UPDATE`;
      const persistedActor = await tx.user.findUnique({ where: { id: actor.id } });
      assertPermission(persistedActor, 'users.manage');
      if (input.timeZone === undefined && id) value.timeZone = undefined;
      return saveUserInTransaction(tx, persistedActor!, value, id, confirmation);
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new Error("That email address is already in use.");
    throw error;
  }
}

// Delegation cannot create, recover, or modify an administrative identity.
export function assertUserAdministrationTarget(actor: Actor, existing: { role: UserRole; delegatedUserAdministrationEnabled?: boolean } | null, next: UserInput) {
  assertPermission(actor, 'users.manage');
  if (actor.role !== 'ADMIN' && (existing?.role === 'ADMIN' || existing?.delegatedUserAdministrationEnabled || next.role === 'ADMIN' || next.delegatedUserAdministrationEnabled === true || (next.delegatedUserAdministrationEnabled !== undefined && next.delegatedUserAdministrationEnabled !== (existing?.delegatedUserAdministrationEnabled ?? false)))) throw new Error('Only an Administrator may manage administrative access.');
  const delegation = next.delegatedUserAdministrationEnabled ?? existing?.delegatedUserAdministrationEnabled ?? false;
  if (delegation && (next.role !== 'SALES_MANAGER' || !next.active)) throw new Error('User Administration Access requires an active Sales Manager. Set it to No before changing role or status.');
}

/** Shared lifecycle write path; caller holds the user administration lock. */
export async function saveUserInTransaction(tx: Prisma.TransactionClient, actor: Actor, value: UserInput, id?: number, confirmation?: string) {
      if (id) {
        const existing = await tx.user.findUnique({ where: { id } });
        if (!existing || existing.archivedAt) throw new Error("User not found.");
        if (value.timeZone === undefined) value.timeZone = existing.timeZone;
        assertUserAdministrationTarget(actor, existing, value);
        await assertUsableAdminRemains(tx, id, value);
        const next = { ...existing, ...value };
        const impact = await userChangeImpact(tx, actor, existing, next);
        const digest = impactConfirmation(existing, next, impact);
        if (impact.length && confirmation !== digest) throw new UserImpactRequired(impact, digest);
        if (existing.firstName !== next.firstName || existing.lastName !== next.lastName) await recordUserHistory(tx, actor.id, id, 'Name changed', `${existing.firstName} ${existing.lastName}`, `${next.firstName} ${next.lastName}`);
        const changes = { role: 'Role changed', active: 'Status changed', email: 'Email changed', timeZone: 'Timezone changed', delegatedUserAdministrationEnabled: 'Delegation changed' } as const;
        for (const [key, action] of Object.entries(changes)) {
          const field = key as keyof typeof changes;
          if (existing[field] !== next[field]) await recordUserHistory(tx, actor.id, id, action as UserHistoryAction, String(existing[field]), String(next[field]));
        }
        return (await tx.user.update({ where: { id }, data: value })).id;
      }
      assertUserAdministrationTarget(actor, null, value);
      const created = await tx.user.create({ data: value });
      await recordUserHistory(tx, actor.id, created.id, 'User created', undefined, value.role);
      if (value.delegatedUserAdministrationEnabled) await recordUserHistory(tx, actor.id, created.id, 'Delegation changed', 'false', 'true');
      return created.id;
}
