import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const backupScript = path.join(root, 'scripts/operations/backup-database.py');
const checksumScript = path.join(root, 'scripts/operations/check-migration-checksums.py');

function python(script, args = []) {
  return spawnSync('python3', [script, ...args], { encoding: 'utf8' });
}

function evaluate(script, expression, args = []) {
  const source = [
    'import runpy, sys',
    'module = runpy.run_path(sys.argv[1])',
    expression,
  ].join('\n');
  return spawnSync('python3', ['-c', source, script, ...args], { encoding: 'utf8' });
}

test('backup labels default to migration and accept safe explicit values', () => {
  const defaultLabel = evaluate(backupScript, "print(module['parse_args']([]).label)");
  assert.equal(defaultLabel.status, 0, defaultLabel.stderr);
  assert.equal(defaultLabel.stdout.trim(), 'migration');

  const explicitLabel = evaluate(backupScript, "print(module['parse_args'](['--label', sys.argv[2]]).label)", ['trade_show_routing']);
  assert.equal(explicitLabel.status, 0, explicitLabel.stderr);
  assert.equal(explicitLabel.stdout.trim(), 'trade_show_routing');
});

test('backup labels reject traversal and unsafe filename characters before backup work', () => {
  for (const label of ['../trade_show', 'trade/show', 'trade show', '.hidden', '']) {
    const result = python(backupScript, ['--label', label]);
    assert.notEqual(result.status, 0, `accepted unsafe label ${JSON.stringify(label)}`);
    assert.match(result.stderr, /label must be/);
  }
});

test('expected pending migrations default to none and are sorted explicitly', () => {
  const defaults = evaluate(checksumScript, "print(repr(module['parse_args']([]).expected_pending))");
  assert.equal(defaults.status, 0, defaults.stderr);
  assert.equal(defaults.stdout.trim(), '[]');

  const explicit = evaluate(
    checksumScript,
    "print(repr(module['parse_args'](['--expected-pending', sys.argv[2], '--expected-pending', sys.argv[3]]).expected_pending))",
    ['20260923190001_second', '20260923190000_first'],
  );
  assert.equal(explicit.status, 0, explicit.stderr);
  assert.equal(explicit.stdout.trim(), "['20260923190000_first', '20260923190001_second']");
});

test('pending migration comparison rejects missing and additional migrations', () => {
  const matches = evaluate(checksumScript, "module['require_expected_pending'](['one'], ['one'])");
  assert.equal(matches.status, 0, matches.stderr);

  const missing = evaluate(checksumScript, "module['require_expected_pending']([], ['one'])");
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /expected \['one'\]; found none/);

  const additional = evaluate(checksumScript, "module['require_expected_pending'](['one', 'two'], ['one'])");
  assert.notEqual(additional.status, 0);
  assert.match(additional.stderr, /expected \['one'\]; found \['one', 'two'\]/);
});

test('expected pending migration names reject unsafe values and duplicates', () => {
  for (const name of ['../migration', 'migration/name', 'migration name', '.hidden']) {
    const result = python(checksumScript, ['--expected-pending', name]);
    assert.notEqual(result.status, 0, `accepted unsafe migration name ${JSON.stringify(name)}`);
    assert.match(result.stderr, /migration name must be/);
  }

  const duplicate = python(checksumScript, ['--expected-pending', 'one', '--expected-pending', 'one']);
  assert.notEqual(duplicate.status, 0);
  assert.match(duplicate.stderr, /must not be repeated/);
});
