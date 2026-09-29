/* eslint-disable @typescript-eslint/no-require-imports */
// Read-only Rosa preview against the local Compose CRM database.
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const ts = require('typescript');
const { PrismaClient } = require('@prisma/client');
Module._extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const { parseDemoCsv, planDemoImport } = require(path.resolve(__dirname, '../../lib/demo-import.ts'));
async function main() {
  const client = new PrismaClient();
  try {
    const parsed = parseDemoCsv(fs.readFileSync(0, 'utf8'));
    const existingDemoCount = await client.demoRequest.count();
    const plan = await planDemoImport(client, parsed, 'demo-requests-2026-09-28.csv');
    console.log(JSON.stringify({ existingDemoCount, sourceRows: plan.sourceRowCount, groupedRequests: plan.groups.length, counts: plan.counts, errors: plan.errors, groups: plan.groups.map(group => ({ requestId: group.requestId, demoNumber: group.demoNumber, customer: group.header.VAR, status: group.status, disposition: group.disposition, reasons: group.issues, account: group.account, users: group.users, items: group.items.map(item => ({ sku: item.sourceSku, skuResolution: item.sku, serials: item.serialNumbers, tracking: item.trackingNumbers, locations: item.inventoryLocations })), conflicts: group.conflicts })) }, null, 2));
  } finally { await client.$disconnect(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
