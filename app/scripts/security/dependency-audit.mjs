import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { decide, publish, validatePolicy } from './policy.mjs';

// Follow lockfile edges, including nested copies. Record a representative path
// for each production/development root; npm's nodes identify the affected copies.
export function dependencyPaths(lock) {
  const paths = new Map();
  const locate = (parent, name) => {
    let directory = parent;
    while (true) {
      const candidate = `${directory ? directory + '/' : ''}node_modules/${name}`;
      if (lock.packages[candidate]) return candidate;
      const index = directory.lastIndexOf('/node_modules/');
      if (index >= 0) directory = directory.slice(0, index);
      else if (directory) directory = '';
      else return null;
    }
  };
  for (const type of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    for (const name of Object.keys(lock.packages[''][type] || {})) {
      const root = locate('', name);
      const queue = root ? [{ node: root, chain: [name] }] : [];
      const seen = new Set();
      for (let i = 0; i < queue.length; i++) {
        const { node, chain } = queue[i];
        if (seen.has(node)) continue;
        seen.add(node);
        if (!paths.has(node)) paths.set(node, []);
        paths.get(node).push({ scope: type === 'devDependencies' ? 'development' : 'production', path: chain.join(' > ') });
        const pkg = lock.packages[node];
        for (const child of Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies, ...pkg.peerDependencies })) {
          const target = locate(node, child);
          if (target) queue.push({ node: target, chain: [...chain, child] });
        }
      }
    }
  }
  return paths;
}

export function npmFindings(audit, production, lock, scope = 'production') {
  assert.equal(audit.auditReportVersion, 2, 'Unexpected npm audit schema');
  assert.equal(production.auditReportVersion, 2);
  const paths = dependencyPaths(lock);
  return Object.entries(audit.vulnerabilities).flatMap(([name, v]) => v.nodes.flatMap(node => {
    const pkg = lock.packages[node];
    assert.ok(pkg, `Audit node missing from lock: ${node}`);
    const isProduction = production.vulnerabilities[name]?.nodes.includes(node) || false;
    const root = lock.packages[''];
    const direct = Boolean(root.dependencies?.[name] || root.devDependencies?.[name] || root.optionalDependencies?.[name])
      && node === `node_modules/${name}`;
    const advisories = v.via.filter(a => typeof a === 'object');
    // Aggregate npm findings refer to the vulnerable child by name. Keep them
    // visible as parent upgrade information; the child's actual advisory gates.
    return (advisories.length ? advisories : [{ url: `npm:${name}`, severity: v.severity }]).map(advisory => ({
      source: 'npm', advisory: advisory.url?.split('/').pop() || `npm:${name}`,
      aggregate: !advisories.length,
      package: name, installedVersion: pkg.version, severity: advisory.severity || v.severity,
      relationship: direct ? 'direct' : 'transitive',
      scope: isProduction ? scope : 'development',
      path: node, dependencyPaths: paths.get(node) || [],
      productionInstalled: isProduction, imagePresence: 'Confirm with final-image inventory; lockfile audit alone is not image evidence',
      fixedVersion: !v.fixAvailable ? null : typeof v.fixAvailable === 'object' ? `${v.fixAvailable.name}@${v.fixAvailable.version}` : 'available; inspect advisory range',
      affectedRange: advisory.range || v.range, affectedFunctionality: 'Requires reachability assessment',
    }));
  }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const started = performance.now();
  const output = process.argv[2] ? resolve(process.argv[2])
    : fileURLToPath(new URL('../../reports/security/dependency/', import.meta.url));
  mkdirSync(output, { recursive: true });
  const policy = validatePolicy(JSON.parse(readFileSync(new URL('../../security/vulnerability-policy.json', import.meta.url))));
  const findings = [];
  for (const [label, relative] of [['app', '../..'], ['operations', '../operations/recovery-runtime']]) {
    const cwd = new URL(relative + '/', import.meta.url);
    const lock = JSON.parse(readFileSync(new URL('package-lock.json', cwd)));
    const audits = [];
    for (const prodOnly of [false, true]) {
      const result = spawnSync('npm', ['audit', '--package-lock-only', '--ignore-scripts', '--json', ...(prodOnly ? ['--omit=dev'] : [])],
        { cwd, encoding: 'utf8', timeout: 180000, maxBuffer: 20 * 1024 * 1024 });
      // Fail closed on registry/network/tool failures. Do not persist npm error
      // messages or environment diagnostics in downloadable security evidence.
      const report = JSON.parse(result.stdout || '{}');
      assert.ok(!result.error && [0, 1].includes(result.status) && !report.error && report.auditReportVersion === 2,
        `${label} npm audit unavailable; rerun the scan`);
      writeFileSync(`${output}/${label}${prodOnly ? '-production' : ''}-audit.json`, JSON.stringify(report, null, 2) + '\n');
      audits.push(report);
    }
    findings.push(...npmFindings(audits[0], audits[1], lock, label === 'operations' ? 'operations' : 'production'));
  }
  writeFileSync(`${output}/timings.json`, JSON.stringify({ dependencyAuditSeconds: (performance.now() - started) / 1000 }, null, 2) + '\n');
  process.exitCode = publish(findings.map(f => decide(f, policy)), output, 'Dependency Security');
}
