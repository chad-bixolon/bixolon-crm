#!/usr/bin/env python3
"""Capture/verify table fingerprints without exposing CRM row contents."""
from pathlib import Path
import json
import os
import subprocess
import sys

ROOT=Path(__file__).resolve().parents[3]
os.umask(0o077)
mode=sys.argv[1]
manifest=Path(sys.argv[2]).resolve()
assert manifest.parent == ROOT/'backups'

def query(statement):
    result=subprocess.run(['docker','compose','exec','-T','db','sh','-c',
      'PGOPTIONS="-c default_transaction_read_only=on" exec psql -X -qAt -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d bixolon_crm'],
      cwd=ROOT,input='BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\n'+statement+'\nCOMMIT;',capture_output=True,text=True)
    if result.returncode: raise RuntimeError('Read-only fingerprint query failed; diagnostic output withheld')
    return result.stdout.strip()

def fingerprint(table,columns):
    projection=', '.join('"'+x.replace('"','""')+'"' for x in columns)
    table='"'+table.replace('"','""')+'"'
    return f'''SELECT json_build_object('rows',count(*),'sha256',encode(sha256(convert_to(COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'[]'),'UTF8')),'hex')) FROM (SELECT {projection} FROM {table}) t;'''

if mode in ('capture','capture-forecast'):
    tables=json.loads(query("SELECT json_object_agg(table_name,columns) FROM (SELECT table_name,json_agg(column_name ORDER BY ordinal_position) AS columns FROM information_schema.columns WHERE table_schema='public' AND table_name<>'_prisma_migrations' GROUP BY table_name) x;"))
    if mode=='capture-forecast':
        # The forecast migration intentionally backfills this one column.
        tables['Opportunity'].remove('forecastCategory')
    results=query('\n'.join(fingerprint(t,c) for t,c in sorted(tables.items()))).splitlines()
    data={t:{'columns':c,**json.loads(value)} for (t,c),value in zip(sorted(tables.items()),results,strict=True)}
    with manifest.open('x') as output: json.dump(data,output,indent=2)
    print(f'Captured {len(data)} table fingerprints; total rows: {sum(x["rows"] for x in data.values())}.')
elif mode=='verify':
    data=json.loads(manifest.read_text())
    results=query('\n'.join(fingerprint(t,v['columns']) for t,v in sorted(data.items()))).splitlines()
    for (table,original),value in zip(sorted(data.items()),results,strict=True):
        actual=json.loads(value)
        if actual['sha256']!=original['sha256'] or actual['rows']!=original['rows']:
            raise RuntimeError(f'Data fingerprint mismatch: {table}')
    print(f'PASS: {len(data)} table fingerprints unchanged; all original values and row counts preserved.')
else:
    raise ValueError('Expected capture or verify')
