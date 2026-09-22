// Read-only verification of the supplied ODM workbook against the local catalog.
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
Module._extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText, filename);
const require = Module.createRequire(import.meta.url);
const { parseProductWorkbookXlsx } = require(path.join(root, 'lib/odm-product-workbook.ts'));
const { planProductImport, normalizePartNumber } = require(path.join(root, 'lib/product-import.ts'));
const db = new PrismaClient();
try {
  const workbook = await parseProductWorkbookXlsx(fs.readFileSync(0), undefined, 'USD');
  if (!workbook.csv) throw new Error(workbook.error ?? 'Workbook could not be parsed');
  const initial = await planProductImport(db, workbook.csv);
  const subtypes = Object.fromEntries(initial.items.map(item => [normalizePartNumber(item.after.partNumber), 'OTHER']));
  const reviewed = await planProductImport(db, workbook.csv, undefined, { subtypes });
  const configKey = 'XL5-40CTBG/AMZ';
  const blankCustomerKey = normalizePartNumber(initial.items.find(item => item.source && !item.source.customerCell).after.partNumber);
  const config = await planProductImport(db, workbook.csv, undefined, { subtypes: { ...subtypes, [configKey]: 'SPECIAL_CONFIGURATION' } });
  const accessory = await planProductImport(db, workbook.csv, undefined, { subtypes: { ...subtypes, [configKey]: 'CABLE_PACKAGING_ACCESSORY' } });
  const specific = await planProductImport(db, workbook.csv, undefined, { subtypes: { ...subtypes, [blankCustomerKey]: 'CUSTOMER_SPECIFIC' } });
  const repeated = new Map();
  for (const item of initial.items) repeated.set(normalizePartNumber(item.after.partNumber), (repeated.get(normalizePartNumber(item.after.partNumber)) ?? 0) + 1);
  const result = {
    candidates: initial.items.length,
    odmTopLevel: initial.items.filter(item => item.after.catalogSource === 'ODM').length,
    subtypeReviewRequired: initial.items.filter(item => item.messages.includes('Choose an ODM subtype.')).length,
    reviewedSubtypeOther: reviewed.items.filter(item => item.after.odmSubtype === 'OTHER').length,
    configWithoutAccount: config.items.find(item => normalizePartNumber(item.after.partNumber) === configKey)?.after.odmCustomerAccountId ?? null,
    configNeedsAccountError: config.items.find(item => normalizePartNumber(item.after.partNumber) === configKey)?.messages.some(message => message.includes('needs an existing SalesHub Account')) ?? null,
    accessoryNeedsAccountError: accessory.items.find(item => normalizePartNumber(item.after.partNumber) === configKey)?.messages.some(message => message.includes('needs an existing SalesHub Account')) ?? null,
    specificNeedsAccountError: specific.items.find(item => normalizePartNumber(item.after.partNumber) === blankCustomerKey)?.messages.some(message => message.includes('needs an existing SalesHub Account')) ?? null,
    ncrMultiline: initial.items.filter(item => item.line === 66).map(item => item.after.partNumber),
    repeatedSkuKeys: [...repeated.values()].filter(count => count > 1).length,
    importApplied: false,
  };
  if (result.candidates !== 122 || result.odmTopLevel !== 122 || result.subtypeReviewRequired !== 122 || result.reviewedSubtypeOther !== 122 || result.configNeedsAccountError || result.accessoryNeedsAccountError || !result.specificNeedsAccountError || result.ncrMultiline.join(',') !== 'SRP-S300LOEK/RDU,SRP-S300LOEK/NSU') throw new Error(`Unexpected preview result: ${JSON.stringify(result)}`);
  console.log(JSON.stringify(result, null, 2));
} finally {
  await db.$disconnect();
}
