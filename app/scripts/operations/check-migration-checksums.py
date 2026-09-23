#!/usr/bin/env python3
"""Compare applied Prisma migration checksums with immutable local SQL files."""
import argparse
from pathlib import Path
import hashlib
import re
import subprocess

ROOT = Path(__file__).resolve().parents[3]
SAFE_MIGRATION_NAME = re.compile(r'[A-Za-z0-9][A-Za-z0-9_-]{0,127}\Z')


def migration_name(value):
    if not SAFE_MIGRATION_NAME.fullmatch(value):
        raise argparse.ArgumentTypeError(
            'migration name must be 1-128 characters using only ASCII letters, digits, underscores, or hyphens'
        )
    return value


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        '--expected-pending', action='append', default=[], type=migration_name,
        metavar='MIGRATION_NAME',
        help='migration expected to be pending; repeat for multiple migrations (default: none)',
    )
    options = parser.parse_args(argv)
    if len(options.expected_pending) != len(set(options.expected_pending)):
        parser.error('--expected-pending values must not be repeated')
    options.expected_pending.sort()
    return options


def require_expected_pending(actual, expected):
    if actual != expected:
        raise SystemExit(f'Unexpected pending migrations: expected {expected or "none"}; found {actual or "none"}')


def main(argv=None):
    options = parse_args(argv)
    result = subprocess.run(['docker','compose','exec','-T','db','sh','-c',
        'exec psql -X -qAt -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT migration_name, checksum, finished_at IS NOT NULL, rolled_back_at IS NOT NULL FROM _prisma_migrations ORDER BY started_at"'],
        cwd=ROOT, capture_output=True, text=True, check=True)
    applied = {}
    for line in result.stdout.strip().splitlines():
        name, checksum, finished, rolled_back = line.split('|')
        if finished != 't' or rolled_back != 'f' or name in applied:
            raise SystemExit(f'Unexpected migration history state: {name}')
        applied[name] = checksum
    for name, checksum in applied.items():
        file = ROOT / 'app/prisma/migrations' / name / 'migration.sql'
        if not file.is_file() or hashlib.sha256(file.read_bytes()).hexdigest() != checksum:
            raise SystemExit(f'Migration checksum mismatch: {name}')
    pending = sorted(path.name for path in (ROOT / 'app/prisma/migrations').iterdir() if path.is_dir() and path.name not in applied)
    require_expected_pending(pending, options.expected_pending)
    print(f'PASS: {len(applied)} migration checksums match; pending: {pending or "none"}.')


if __name__ == '__main__':
    main()
