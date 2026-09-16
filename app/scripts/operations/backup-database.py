#!/usr/bin/env python3
"""Create and validate a protected PostgreSQL custom-format backup; never print data."""
from datetime import datetime, timezone
from pathlib import Path
import hashlib
import json
import os
import subprocess

ROOT = Path(__file__).resolve().parents[3]
os.umask(0o077)
folder = ROOT / 'backups'
folder.mkdir(mode=0o700, exist_ok=True)
folder.chmod(0o700)
timestamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
path = folder / f'bixolon_crm_before_foundation_{timestamp}.dump'
command = ['docker','compose','exec','-T','db','sh','-c',
           'exec pg_dump --format=custom --no-owner --no-privileges -U "$POSTGRES_USER" -d bixolon_crm']
with path.open('xb') as output:
    result = subprocess.run(command, cwd=ROOT, stdout=output, stderr=subprocess.PIPE)
    output.flush()
    os.fsync(output.fileno())
if result.returncode != 0:
    raise SystemExit('Backup failed; do not migrate. Diagnostic output withheld to protect connection details.')
assert path.stat().st_size > 0
# Check TOC readability and fully decode all archive entries without executing SQL.
for args in [['--list'], ['--file=/dev/null']]:
    with path.open('rb') as source:
        result = subprocess.run(['docker','compose','exec','-T','db','pg_restore',*args],
                                cwd=ROOT,stdin=source,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    if result.returncode != 0:
        raise SystemExit('Archive validation failed; do not migrate.')
manifest = {'backup':str(path),'size_bytes':path.stat().st_size,
            'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),
            'format':'PostgreSQL custom','pg_dump_exit':0,'toc_verified':True,
            'full_archive_decode_verified':True,'permissions':oct(path.stat().st_mode & 0o777)}
path.with_suffix('.manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(json.dumps(manifest,indent=2))
