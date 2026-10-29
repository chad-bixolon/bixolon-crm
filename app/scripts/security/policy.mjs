import assert from 'node:assert/strict';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;

export function validatePolicy(policy) {
  assert.equal(policy.version, 1);
  for (const kind of ['assessments', 'exceptions']) {
    assert.ok(Array.isArray(policy[kind]));
    const keys = new Set();
    for (const item of policy[kind]) {
      for (const key of ['advisory', 'package', 'installedVersion', 'severity', 'relationship', 'scope', 'exposure', 'evidence', 'mitigation', 'owner']) {
        assert.ok(typeof item[key] === 'string' && item[key].trim(), `${kind}: missing ${key}`);
      }
      assert.ok(['production', 'development', 'operations'].includes(item.scope));
      assert.ok(['direct', 'transitive', 'os', 'bundled'].includes(item.relationship));
      assert.ok(['critical', 'high', 'moderate', 'medium', 'low', 'info', 'unknown'].includes(item.severity));
      assert.ok(['reachable', 'material', 'unreachable', 'unknown'].includes(item.exposure));
      assert.ok(item.releaseBlocking === undefined || typeof item.releaseBlocking === 'boolean');
      assert.ok(date(item.reviewedAt) && date(item.expires), 'Dated review and expiration required');
      const duration = Date.parse(item.expires) - Date.parse(item.reviewedAt);
      assert.ok(duration > 0 && duration <= 90 * 86400000, 'Review must expire within 90 days');
      const key = [item.advisory, item.package, item.installedVersion, item.scope].join(':');
      assert.ok(!keys.has(key), 'Duplicate policy entry');
      keys.add(key);
    }
  }
  return policy;
}

export function decide(finding, policy, now = new Date()) {
  const matches = item => item.advisory === finding.advisory && item.package === finding.package
    && item.installedVersion === finding.installedVersion && item.scope === finding.scope
    && item.severity === finding.severity && Date.parse(item.reviewedAt) <= now.getTime()
    && Date.parse(item.expires) + 86400000 > now.getTime();
  const assessment = policy.assessments.find(matches);
  const exposure = assessment?.exposure || 'unknown';
  const significant = ['critical', 'high'].includes(finding.severity);
  // Production npm exposure defaults to unknown, requiring review before release.
  // A dated, evidenced unreachable assessment can clear it without an exception.
  const block = assessment?.releaseBlocking === true || (finding.source === 'npm'
    ? !finding.aggregate && significant && (['reachable', 'material'].includes(exposure)
      || (finding.scope !== 'development' && exposure !== 'unreachable'))
    : (finding.severity === 'critical' && Boolean(finding.fixedVersion))
      || (significant && ['reachable', 'material'].includes(exposure)));
  const exception = policy.exceptions.find(matches);
  return { ...finding, exposure, assessment: assessment || null, exception: exception || null,
    blocking: block && !exception,
    disposition: exception ? 'temporary exception' : block ? 'release blocking' : significant ? 'prompt review' : 'report and track' };
}

export function containerFindings(report, scope) {
  assert.equal(report.SchemaVersion, 2, 'Unexpected Trivy schema');
  assert.ok(report.Metadata?.ImageID, 'An actual image scan is required');
  assert.ok(Array.isArray(report.Results), 'Missing Trivy results');
  return report.Results.flatMap(result => (result.Vulnerabilities || []).map(v => ({
    source: 'container', advisory: v.VulnerabilityID, package: v.PkgName,
    installedVersion: v.InstalledVersion, severity: v.Severity.toLowerCase(),
    fixedVersion: v.FixedVersion || null, scope,
    relationship: result.Class === 'os-pkgs' ? 'os' : 'bundled',
    path: result.Target, packagePath: v.PkgPath || null, layer: v.Layer?.DiffID || null,
  })));
}

const escape = value => String(value).replace(/[|\n\r<>`]/g, ' ');
export function publish(findings, output, title) {
  const blocking = findings.filter(f => f.blocking);
  const ranks = { critical: 5, high: 4, medium: 3, moderate: 3, low: 2, info: 1, unknown: 0 };
  const ordered = [...findings].sort((a, b) => Number(b.blocking) - Number(a.blocking)
    || (ranks[b.severity] || 0) - (ranks[a.severity] || 0));
  const counts = {};
  for (const f of findings) counts[f.severity] = (counts[f.severity] || 0) + 1;
  const summary = `### ${title}\n\n${findings.length} findings; ${blocking.length} blocking. Severity counts: ${JSON.stringify(counts)}.\n\n`
    + 'Full findings, unfixed vulnerabilities, dependency paths and timings are in the bounded security artifact. Unknown exposure is not proof of reachability.\n\n'
    + (findings.length ? '| Advisory | Package | Scope | Severity | Fix | Decision |\n| --- | --- | --- | --- | --- | --- |\n'
      + ordered.slice(0, 40).map(f => `| ${[f.advisory, `${f.package}@${f.installedVersion}`, f.scope, f.severity, f.fixedVersion || 'none reported', f.disposition].map(escape).join(' | ')} |`).join('\n') + '\n' : 'No known vulnerabilities reported by this scan.\n');
  writeFileSync(`${output}/policy-report.json`, JSON.stringify({ generatedAt: new Date().toISOString(), counts, blocking: blocking.length, findings }, null, 2) + '\n');
  writeFileSync(`${output}/summary.md`, summary);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  console.log(`${title}: ${findings.length} findings, ${blocking.length} blocking`);
  return blocking.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [input, scope, output] = process.argv.slice(2);
  assert.ok(['production', 'operations'].includes(scope));
  const policy = validatePolicy(JSON.parse(readFileSync(new URL('../../security/vulnerability-policy.json', import.meta.url))));
  const findings = containerFindings(JSON.parse(readFileSync(input)), scope).map(f => decide(f, policy));
  process.exitCode = publish(findings, output, `Container Security: ${scope}`);
}
