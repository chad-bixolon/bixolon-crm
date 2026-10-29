import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { createRequire } from 'node:module';
import { migrationChanged } from '../scripts/release-check.mjs';
import { securityScope } from '../scripts/security/scope.mjs';
import { containerFindings, decide, validatePolicy } from '../scripts/security/policy.mjs';
import { dependencyPaths, npmFindings } from '../scripts/security/dependency-audit.mjs';

const { load } = createRequire(import.meta.url)('js-yaml');
const readYaml = path => load(readFileSync(new URL(path, import.meta.url), 'utf8'));
const ci = readYaml('../../.github/workflows/ci.yml');
const security = readYaml('../../.github/workflows/security.yml');
const sarif = readYaml('../../.github/workflows/security-sarif.yml');
const scan = readYaml('../../.github/actions/scan-image/action.yml');
const dependabot = readYaml('../../.github/dependabot.yml');
const emptyPolicy = { version: 1, assessments: [], exceptions: [] };

const workflow = readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');
const release = readFileSync(new URL('../scripts/release-check.mjs', import.meta.url), 'utf8');
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('hosted CI keeps the local release gates and pinned runtime', () => {
  for (const command of ['ci:preflight', 'prisma:generate', 'ci:prisma-alignment', 'lint', 'typecheck', 'test:e2e:release-smoke', 'build:release']) {
    assert.ok(pkg.scripts[command], `Missing npm script: ${command}`);
    assert.ok(workflow.includes(`npm run ${command}`), `CI no longer runs ${command}`);
  }
  assert.match(workflow, /run: npm test\s/);
  assert.match(workflow, /node-version-file: app\/\.nvmrc/);
  assert.match(workflow, /image: postgres:17/);
  assert.match(workflow, /55432:5432/);
  assert.match(workflow, /git diff --check "\$PR_BASE_SHA" HEAD/);
  assert.match(workflow, /git diff --check "\$PUSH_BEFORE_SHA" HEAD/);
  assert.match(workflow, /permissions:\s+contents: read/);
  assert.match(workflow, /Decide production image scope[\s\S]*?Build production Docker image/);
  assert.match(workflow, /app\/prisma\/schema\.prisma app\/prisma\.config\.ts app\/prisma\/migrations\/ app\/prisma\/tests\/ app\/scripts\/test-migrations\.py app\/scripts\/prisma-generate\.mjs app\/Dockerfile app\/\.dockerignore app\/package\.json app\/package-lock\.json \.github\/workflows\/ci\.yml/);
  assert.match(workflow, /npm run test:migrations/);
  for (const path of ['app/prisma/schema.prisma', 'app/prisma.config.ts', 'app/prisma/migrations/20261027_ci/migration.sql', 'app/prisma/tests/integrity.sql', 'app/scripts/test-migrations.py', 'app/scripts/prisma-generate.mjs', 'app/Dockerfile', 'app/.dockerignore', 'app/package.json', 'app/package-lock.json', '.github/workflows/ci.yml']) {
    assert.equal(migrationChanged([path]), true, 'Local release check would skip ' + path);
  }
  assert.match(pkg.scripts['build:release'], /--webpack/);
  assert.match(pkg.scripts['test:e2e:release-smoke'], /--workers=1 --retries=0/);
  assert.match(pkg.scripts['test:migrations'], /scripts\/test-migrations\.py/);
  for (const command of ['test:migrations', 'test:e2e:release-smoke', 'build:release']) {
    assert.ok(release.includes(`'${command}'`), `Local release checker no longer uses ${command}`);
  }
});

test('Dependabot YAML keeps weekly independent ecosystems, bounded PRs and separate major updates', () => {
  assert.equal(dependabot.version, 2);
  assert.deepEqual(dependabot.updates.map(u => [u['package-ecosystem'], u.directory]), [
    ['npm', '/app'], ['npm', '/app/scripts/operations/recovery-runtime'], ['github-actions', '/'],
  ]);
  for (const entry of dependabot.updates) {
    assert.equal(entry.schedule.interval, 'weekly');
    assert.ok(entry['open-pull-requests-limit'] > 0 && entry['open-pull-requests-limit'] <= 3);
    assert.equal(entry.ignore, undefined, 'Do not suppress major or security updates');
    assert.equal(entry['target-branch'], undefined, 'Security updates must use default branch settings');
    for (const group of Object.values(entry.groups)) {
      assert.equal(group['applies-to'], 'version-updates');
      assert.deepEqual([...group['update-types']].sort(), ['minor', 'patch']);
    }
  }
});

test('security scans preserve required CI and use safe PR/main/weekly triggers', () => {
  for (const config of [ci, security]) {
    assert.deepEqual(config.on.pull_request.branches, ['main']);
    assert.deepEqual(config.on.push.branches, ['main']);
    assert.equal(config.on.pull_request_target, undefined);
    assert.equal(config.on.workflow_run, undefined);
    assert.deepEqual(config.permissions, { contents: 'read' });
  }
  assert.deepEqual(security.on.schedule, [{ cron: '23 8 * * 1' }]);
  assert.ok(Object.hasOwn(security.on, 'workflow_dispatch'));
  for (const key of ['standard', 'migration', 'docker']) {
    assert.equal(ci.jobs[key]['continue-on-error'], undefined);
    assert.equal(ci.jobs[key].if, undefined);
  }
  assert.equal(ci.jobs.standard.name, 'Standard CI');
  assert.equal(ci.jobs.migration.name, 'Migration validation');
  assert.equal(ci.jobs.docker.name, 'Production Docker build');
  assert.equal(security.jobs.dependency.name, 'Dependency Security');
  assert.match(security.jobs['scheduled-production'].if, /schedule.*workflow_dispatch/);
  const productionBuilds = ci.jobs.docker.steps.filter(s => /docker build/.test(s.run || ''));
  assert.equal(productionBuilds.length, 1);
  assert.match(productionBuilds[0].run, /docker build --pull --target production -t saleshub-ci-production:local \.\/app/);
  const scanStep = ci.jobs.docker.steps.find(s => s.uses === './.github/actions/scan-image');
  assert.deepEqual(scanStep.with, { image: 'saleshub-ci-production:local', scope: 'production' });
  assert.match(security.jobs.operations.steps.find(s => /docker build/.test(s.run || '')).run, /-f app\/Dockerfile\.operations/);
  assert.match(security.jobs['scheduled-production'].steps.find(s => /docker build/.test(s.run || '')).run, /--target production/);
});

test('PR scan selection covers runtime/dependency changes and skips documentation-only builds', () => {
  assert.deepEqual(securityScope(['app/docs/help.md'], 'pull_request'), { dependency: false, production: false, operations: false });
  assert.equal(securityScope(['app/package-lock.json'], 'pull_request').dependency, true);
  assert.equal(securityScope(['app/package-lock.json'], 'pull_request').production, true);
  assert.equal(securityScope(['app/lib/uploads.ts'], 'pull_request').production, true);
  for (const file of ['app/Dockerfile.operations', 'app/scripts/operations/recovery-runtime/package-lock.json', 'app/prisma/schema.prisma', 'app/scripts/prisma-generate.mjs']) {
    assert.equal(securityScope([file], 'pull_request').operations, true, file);
  }
  for (const event of ['push', 'schedule', 'workflow_dispatch']) {
    assert.deepEqual(securityScope([], event), { dependency: true, production: true, operations: true });
  }
  for (const file of ['.github/actions/scan-image/action.yml', '.github/workflows/security.yml', 'app/security/vulnerability-policy.json', 'app/scripts/security/policy.mjs']) {
    assert.deepEqual(securityScope([file], 'pull_request'), { dependency: true, production: true, operations: true });
  }
});

test('only optional isolated SARIF publication gets security-events write', () => {
  for (const config of [ci, security, sarif]) {
    for (const [key, job] of Object.entries(config.jobs)) {
      if (job.permissions?.['security-events'] === 'write') {
        assert.ok(key.startsWith('sarif-') || key === 'publish');
        assert.deepEqual(job.permissions, { contents: 'read', actions: 'read', 'security-events': 'write' });
        assert.equal((job.steps || []).some(s => s.uses?.startsWith('actions/checkout')), false);
      } else {
        assert.ok(!Object.values(job.permissions || {}).includes('write'));
      }
    }
  }
  assert.match(security.jobs['dependency-review'].if, /SECURITY_DEPENDENCY_REVIEW_ENABLED/);
  assert.ok(sarif.jobs.publish.steps.find(s => s.uses?.startsWith('github/codeql-action/upload-sarif@'))['continue-on-error']);
});

test('security action pins, evidence retention, inventory/SBOM and secret-free configuration remain bounded', () => {
  const steps = [...Object.values(ci.jobs), ...Object.values(security.jobs), ...Object.values(sarif.jobs)].flatMap(j => j.steps || []).concat(scan.runs.steps);
  for (const step of steps) {
    if (step.uses && !step.uses.startsWith('./')) {
      assert.match(step.uses, /^(?:actions\/(?:checkout|setup-node|upload-artifact)@v7|actions\/download-artifact@v8|(?:aquasecurity\/trivy-action|actions\/dependency-review-action|github\/codeql-action\/upload-sarif)@[a-f0-9]{40})$/);
    }
    if (step.uses?.startsWith('actions/upload-artifact')) {
      assert.ok(step.with['retention-days'] >= 7 && step.with['retention-days'] <= 14);
      assert.doesNotMatch(step.with.path, /\.env|backups|\.pem|node_modules|\/\*\*|^\.$/);
    }
  }
  const trivy = scan.runs.steps.find(s => s.uses?.startsWith('aquasecurity/trivy-action'));
  assert.equal(trivy.with.version, 'v0.76.1');
  assert.equal(trivy.with['scan-type'], 'image');
  assert.equal(trivy.with.scanners, 'vuln');
  assert.equal(trivy.with['vuln-type'], 'os,library');
  assert.equal(trivy.with['ignore-unfixed'], 'false');
  assert.equal(trivy.with['list-all-pkgs'], 'true');
  assert.equal(trivy.with['exit-code'], '0', 'Reviewed policy gates after evidence generation');
  assert.equal(trivy.env.TRIVY_LIST_ALL_PKGS, 'true');
  assert.equal(trivy.env.TRIVY_IMAGE_SRC, 'docker');
  assert.equal(trivy.env.TRIVY_IGNOREFILE, '/dev/null');
  const conversion = scan.runs.steps.find(s => /trivy convert/.test(s.run || '')).run;
  assert.match(conversion, /--format cyclonedx --output "\$output\/sbom\.cdx\.json" "\$output\/trivy\.json"/);
  assert.match(conversion, /--format sarif/);
  const evidence = scan.runs.steps.find(s => s.uses?.startsWith('actions/upload-artifact'));
  assert.match(evidence.if, /always\(\)/);
  const allSecurityText = JSON.stringify([security, scan, sarif, ci.jobs.docker]);
  assert.doesNotMatch(allSecurityText, /secrets\.|DATABASE_URL|AUTH_SECRET|AUTH_GOOGLE|SPACES_SECRET|PRIVATE_KEY|BACKUP_|printenv|docker compose|DigitalOcean|doctl|npm audit --audit-level|auto-merge|enable-auto-merge/i);
});

test('dependency policy gates exposure and scope, including unfixed significant npm findings', () => {
  const now = new Date('2026-10-29T12:00:00Z');
  const finding = { source: 'npm', advisory: 'GHSA-test', package: 'example', installedVersion: '1.0.0', severity: 'high', scope: 'production', relationship: 'transitive', fixedVersion: null };
  const assessment = { ...finding, exposure: 'unreachable', evidence: 'Only a CLI parser; never invoked by the HTTP runtime; no attacker input', mitigation: 'Review CLI inputs; patch when available', owner: 'Security owner', reviewedAt: '2026-10-29', expires: '2026-11-12' };
  assert.equal(decide(finding, emptyPolicy, now).blocking, true);
  assert.equal(decide({ ...finding, scope: 'development' }, emptyPolicy, now).blocking, false);
  assert.equal(decide({ ...finding, aggregate: true }, emptyPolicy, now).blocking, false);
  const policy = validatePolicy({ ...emptyPolicy, assessments: [assessment] });
  assert.equal(decide(finding, policy, now).blocking, false);
  assert.equal(decide(finding, policy, new Date('2026-11-14')).blocking, true);
  assert.equal(decide({ ...finding, installedVersion: '1.0.1' }, policy, now).blocking, true);
  for (const exposure of ['reachable', 'material']) {
    assert.equal(decide({ ...finding, scope: 'development' }, { ...emptyPolicy, assessments: [{ ...assessment, scope: 'development', exposure }] }, now).blocking, true);
  }
  for (const severity of ['moderate', 'low']) assert.equal(decide({ ...finding, severity }, emptyPolicy, now).blocking, false);
  assert.equal(decide({ ...finding, severity: 'moderate' }, { ...emptyPolicy, assessments: [{ ...assessment, severity: 'moderate', exposure: 'material', releaseBlocking: true }] }, now).blocking, true);
  const exceptionPolicy = validatePolicy({ ...emptyPolicy, exceptions: [{ ...assessment, exposure: 'material' }] });
  assert.equal(decide(finding, exceptionPolicy, now).blocking, false);
  assert.equal(decide(finding, exceptionPolicy, new Date('2026-11-14')).blocking, true);
  assert.throws(() => validatePolicy({ ...emptyPolicy, exceptions: [{ ...assessment, expires: undefined }] }));
  assert.throws(() => validatePolicy({ ...emptyPolicy, exceptions: [{ ...assessment, expires: '2028-01-01' }] }));
  assert.throws(() => validatePolicy({ ...emptyPolicy, exceptions: [{ ...assessment, evidence: '' }] }));
  validatePolicy(JSON.parse(readFileSync(new URL('../security/vulnerability-policy.json', import.meta.url))));
});

test('container gates fixed Critical and assessed material High while retaining unfixed findings', () => {
  const report = { SchemaVersion: 2, Metadata: { ImageID: 'sha256:example' }, Results: [{ Target: 'debian', Class: 'os-pkgs', Vulnerabilities: [
    { VulnerabilityID: 'CVE-test', PkgName: 'libexample', InstalledVersion: '1', Severity: 'CRITICAL', FixedVersion: '2' },
    { VulnerabilityID: 'CVE-unfixed', PkgName: 'libexample', InstalledVersion: '1', Severity: 'CRITICAL' },
    { VulnerabilityID: 'CVE-high', PkgName: 'libexample', InstalledVersion: '1', Severity: 'HIGH', FixedVersion: '2' },
  ] }] };
  const findings = containerFindings(report, 'production');
  assert.equal(findings.length, 3);
  assert.deepEqual(findings.map(f => decide(f, emptyPolicy).blocking), [true, false, false]);
  assert.equal(decide(findings[0], { ...emptyPolicy, assessments: [{ ...findings[0], exposure: 'unreachable', reviewedAt: '2026-10-29', expires: '2026-11-12' }] }, new Date('2026-10-30')).blocking, true);
  assert.equal(decide(findings[2], { ...emptyPolicy, assessments: [{ ...findings[2], exposure: 'material', reviewedAt: '2026-10-29', expires: '2026-11-12' }] }, new Date('2026-10-30')).blocking, true);
  assert.throws(() => containerFindings({ ...report, Metadata: {} }, 'production'));
});

test('npm evidence distinguishes direct/transitive and production/development copies and paths', () => {
  const lock = { packages: {
    '': { dependencies: { web: '1' }, devDependencies: { tool: '1' } },
    'node_modules/web': { version: '1', dependencies: { shared: '1' } },
    'node_modules/tool': { version: '1', dependencies: { shared: '2' } },
    'node_modules/shared': { version: '1' },
    'node_modules/tool/node_modules/shared': { version: '2', dev: true },
  } };
  const vulnerability = (nodes, via) => ({ nodes, via, severity: 'high', fixAvailable: false, range: '*' });
  const advisory = { url: 'https://github.com/advisories/GHSA-test', severity: 'high', range: '*' };
  const audit = { auditReportVersion: 2, vulnerabilities: {
    shared: vulnerability(['node_modules/shared', 'node_modules/tool/node_modules/shared'], [advisory]),
    web: vulnerability(['node_modules/web'], ['shared']),
    tool: vulnerability(['node_modules/tool'], [advisory]),
  } };
  const prod = { auditReportVersion: 2, vulnerabilities: { shared: vulnerability(['node_modules/shared'], [advisory]), web: audit.vulnerabilities.web } };
  const findings = npmFindings(audit, prod, lock);
  assert.deepEqual(findings.map(f => [f.relationship, f.scope]), [
    ['transitive', 'production'], ['transitive', 'development'], ['direct', 'production'], ['direct', 'development'],
  ]);
  assert.equal(findings[0].fixedVersion, null);
  assert.deepEqual(dependencyPaths(lock).get('node_modules/shared'), [{ scope: 'production', path: 'web > shared' }]);
  assert.deepEqual(findings[1].dependencyPaths, [{ scope: 'development', path: 'tool > shared' }]);
});

test('fresh checkout includes every synthetic import source needed by unit tests', () => {
  for (const name of [
    'BIXOLON_Price_List.xlsx',
    'ODM customer pricing_Sep 2026.xlsx',
    'FSTEC.xlsx',
    'Leads_Report_RetailNOW.xlsx',
    'Distributor Price Exceptions 02052020 - Copy.xlsx',
    'price-exceptions-2026-09-25.csv',
    'demo-requests-2026-09-28.csv',
    '2025_Label Printer Sales PLan_2025 Development Projects_12242024.xlsx',
    '2027_Sales Plan_BIXNA_Rev1.xlsx',
  ]) assert.ok(existsSync(new URL(`./fixtures/ci-source/${name}`, import.meta.url)), `Missing CI fixture: ${name}`);
});
