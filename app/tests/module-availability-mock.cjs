/* eslint-disable @typescript-eslint/no-require-imports */
// Existing isolated unit tests use mocked Prisma clients and do not boot a deployment database.
// Supply the BIXOLON all-enabled default at the module boundary; dedicated policy and browser
// tests exercise configured disabled states against the real implementation.
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const ts = require('typescript');

const policyPath = path.resolve(__dirname, '../lib/module-policy.ts');
const policyModule = new Module(policyPath, module);
policyModule.filename = policyPath;
policyModule.paths = Module._nodeModulePaths(path.dirname(policyPath));
policyModule._compile(ts.transpileModule(fs.readFileSync(policyPath, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, policyPath);
const policy = policyModule.exports;
const enabled = policy.resolveModules([]);
const service = {
  ...policy,
  getModuleAvailability: async () => enabled,
  readModules: async () => enabled,
  assertModuleEnabled: async () => {},
  requireModuleEnabled: async () => {},
  assertWorkModuleContext: async () => {},
};
const load = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === '@/lib/module-policy') return policy;
  if (request === '@/lib/module-availability'
    || request === path.resolve(__dirname, '../lib/module-availability')
    || request === path.resolve(__dirname, '../lib/module-availability.ts')
    || /^(?:\.\.?(?:\/\.\.?)*\/)module-availability$/.test(request) && parent?.filename.startsWith(path.resolve(__dirname, '..'))) return service;
  return load.call(this, request, parent, isMain);
};
