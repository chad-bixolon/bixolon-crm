import type { Prisma, PrismaClient } from "@prisma/client";

const businessRoles = new Set(["END_USER", "DISTRIBUTOR", "VAR", "ISV", "OEM", "PARTNER"]);

async function foundationAvailable(tx: Prisma.TransactionClient) {
  const [result] = await tx.$queryRaw<{ ready: boolean }[]>`
    SELECT to_regclass('public."AccountBusinessRole"') IS NOT NULL AS ready
  `;
  return result.ready;
}

// Temporary rollout bridge: the live database stays on the baseline until approval.
// Explicit projections work with either generated client and either database schema.
export async function listAccounts(client: PrismaClient) {
  return client.$transaction(async (tx) => {
    const accounts = await tx.account.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true, name: true, accountType: true, industry: true, territory: true, status: true,
        _count: { select: { contacts: true, opportunities: true } },
      },
    });
    if (!(await foundationAvailable(tx))) return accounts;
    const roles = await tx.$queryRaw<{ accountId: number; roles: string[] }[]>`
      SELECT "accountId", array_agg(role::text ORDER BY role::text) AS roles
      FROM "AccountBusinessRole" GROUP BY "accountId"
    `;
    const memberships = await tx.$queryRaw<{ accountId: number; total: bigint }[]>`
      SELECT "accountId", count(*) AS total FROM "OpportunityAccount" GROUP BY "accountId"
    `;
    const roleMap = new Map(roles.map((row) => [row.accountId, row.roles.join(", ")]));
    const countMap = new Map(memberships.map((row) => [row.accountId, Number(row.total)]));
    return accounts.map((account) => ({
      ...account,
      accountType: roleMap.get(account.id) ?? null,
      _count: { ...account._count, opportunities: countMap.get(account.id) ?? 0 },
    }));
  });
}

type AccountInput = {
  name: string;
  accountType: string | null;
  industry: string | null;
  territory: string | null;
  website: string | null;
  phone: string | null;
};

export async function createAccountRecord(client: PrismaClient, input: AccountInput) {
  if (!input.name.trim()) throw new Error("Account name is required.");
  if (input.accountType && !businessRoles.has(input.accountType)) {
    throw new Error("Invalid account business role.");
  }
  return client.$transaction(async (tx) => {
    const ready = await foundationAvailable(tx);
    // Keep the existing free-text form functional during rollout. A future admin
    // category picker will replace this compatibility behavior; no new UI here.
    if (ready && input.industry) {
      await tx.$executeRaw`INSERT INTO "Industry" (code, name, "updatedAt")
        VALUES (${input.industry}, ${input.industry}, CURRENT_TIMESTAMP) ON CONFLICT (code) DO NOTHING`;
    }
    if (ready && input.territory) {
      await tx.$executeRaw`INSERT INTO "Territory" (code, name, "updatedAt")
        VALUES (${input.territory}, ${input.territory}, CURRENT_TIMESTAMP) ON CONFLICT (code) DO NOTHING`;
    }
    // Raw INSERT avoids a revised client's new schema defaults on the old database.
    const [account] = await tx.$queryRaw<{ id: number }[]>`
      INSERT INTO "Account" (name, "accountType", industry, territory, website, phone, "updatedAt")
      VALUES (${input.name}, ${input.accountType}, ${input.industry}, ${input.territory},
              ${input.website}, ${input.phone}, CURRENT_TIMESTAMP)
      RETURNING id
    `;
    if (ready && input.accountType) {
      await tx.$executeRaw`INSERT INTO "AccountBusinessRole" ("accountId", role, "updatedAt")
        VALUES (${account.id}, ${input.accountType}::"AccountBusinessRoleCode", CURRENT_TIMESTAMP)`;
    }
    return account;
  });
}
