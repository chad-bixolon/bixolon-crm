import { validateRestored } from './restore-postgres.mjs';
// Safe aggregate evidence only. Prisma status is a separate read-only drill step.
try { console.log(JSON.stringify(await validateRestored())); }
catch { console.error('{"event":"restore.failed","stage":"validation"}'); process.exitCode = 1; }
