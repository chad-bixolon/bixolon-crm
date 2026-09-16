// Run with DATABASE_URL configured: node scripts/seed-sales-stages.mjs
// Creates defaults only when the database has no active sales stages.
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
const defaults = [
  ['Identified', 10, false, false], ['Qualified', 25, false, false],
  ['Technical Evaluation', 40, false, false], ['Demo / POC', 50, false, false],
  ['Proposal / Quote', 65, false, false], ['Negotiation', 80, false, false],
  ['Commit', 90, false, false], ['Closed Won', 100, true, true],
  ['Closed Lost', 0, true, false],
];
const prisma = new PrismaClient();
try {
  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(726234011)`;
    if (await tx.salesStage.count({ where: { active: true } })) return 'Active sales stages already exist; no defaults added.';
    for (const [index, [name, probability, isClosed, isWon]] of defaults.entries()) {
      await tx.salesStage.upsert({ where: { name }, update: { active: true }, create: { name, probability, isClosed, isWon, sortOrder: index + 1, active: true } });
    }
    return 'Default sales stages are available.';
  });
  console.log(result);
} finally { await prisma.$disconnect(); }
