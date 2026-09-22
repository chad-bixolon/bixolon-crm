#!/usr/bin/env python3
"""Compare applied Prisma migration checksums with immutable local SQL files."""
from pathlib import Path
import hashlib
import subprocess

ROOT = Path(__file__).resolve().parents[3]
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
if pending not in ([], ['20260921120000_odm_product_skus'], ['20260921130000_odm_sku_customers'], ['20260921120000_odm_product_skus', '20260921130000_odm_sku_customers']):
    raise SystemExit(f'Unexpected pending migrations: {pending}')
print(f'PASS: {len(applied)} migration checksums match; pending: {pending or "none"}.')
