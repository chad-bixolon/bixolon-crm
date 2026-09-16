#!/usr/bin/env python3
"""Run the existing integrity assertions on rollback-only, explicitly identified fixtures.

No existing rows are updated/deleted. Every fixture ID is explicit (no sequence use).
A collision guard runs before any fixture writes. Disconnect/error also rolls back.
"""
from pathlib import Path
import re
import subprocess
import uuid

ROOT=Path(__file__).resolve().parents[3]
APP=ROOT/'app'
nonce=uuid.uuid4().hex
prefix='foundation_verification_'+nonce
base=-2100000000
mapping={str(n):str(base+n) for n in [100,101,102,103,200]}
fixture=(APP/'prisma/tests/legacy-fixture.sql').read_text().split('-- Capture every original value')[0]
statements=[]
for match in re.finditer(r'INSERT INTO "(\w+)"\s*\((.*?)\)\s*VALUES\s*(.*?);',fixture,re.S):
    table,columns,values=match.groups()
    names=[x.strip().strip('"') for x in columns.split(',')]
    rows=[]
    for row in re.findall(r'\(([^()]*)\)',values):
        cells=re.split(r",(?=(?:[^']*'[^']*')*[^']*$)",row)
        assert len(cells)==len(names)
        for i,column in enumerate(names):
            value=cells[i].strip()
            if column=='id' or column.endswith('Id'):
                cells[i]=mapping.get(value,value)
        rows.append('('+','.join(cells)+')')
    sql=f'INSERT INTO "{table}" ({columns}) VALUES '+','.join(rows)+';'
    for old,new in {
      "'fixture@example.invalid'":f"'{prefix}@example.invalid'",
      "' Retail '":f"'{prefix}_industry'", "'East'":f"'{prefix}_territory'",
      "'Custom activity'":f"'{prefix}_activity'", "'Qualified'":f"'{prefix}_qualified'",
      "'Won'":f"'{prefix}_won'", "'Lost'":f"'{prefix}_lost'", "'FIXTURE-001'":f"'{prefix}_product'",
    }.items(): sql=sql.replace(old,new)
    statements.append(sql)
    if table=='Account':
        statements.append(f'''INSERT INTO "AccountBusinessRole" ("accountId",role,"updatedAt") VALUES ({mapping['100']},'VAR',now()),({mapping['101']},'END_USER',now());''')
    if table=='Opportunity':
        statements.append(f'''INSERT INTO "OpportunityAccount" ("opportunityId","accountId","updatedAt") VALUES ({mapping['100']},{mapping['100']},now());''')
assert len(statements)==12
prelude=f'''
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';
DO $$ DECLARE t text; collision boolean; BEGIN
  FOREACH t IN ARRAY ARRAY['User','Account','Contact','SalesStage','Opportunity','Product','OpportunityProduct','Task','Activity','Note','ExternalIdentity'] LOOP
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I WHERE id BETWEEN -2100000000 AND -2099998000)',t) INTO collision;
    IF collision THEN RAISE EXCEPTION 'Reserved verification ID collision; no verification fixtures written'; END IF;
  END LOOP;
END $$;
INSERT INTO "Industry"(code,name,"updatedAt") VALUES('{prefix}_industry','{prefix}_industry',now());
INSERT INTO "Territory"(code,name,"updatedAt") VALUES('{prefix}_territory','{prefix}_territory',now());
INSERT INTO "ActivityType"(code,name,"updatedAt") VALUES('{prefix}_activity','{prefix}_activity',now());
'''+ '\n'.join(statements)+'\n'
tests=(APP/'prisma/tests/integrity.sql').read_text()
# Retain the high-bound probability test while replacing fixture IDs only.
tests=tests.replace('probability=101','probability=2147483647')
tests=re.sub(r'\b(?:100|101|102|103|200)\b',lambda m:mapping[m.group()],tests)
fixture_ids=f"{mapping['100']},{mapping['101']}"
for table in ['Activity','Note']:
    tests=tests.replace(f'(SELECT count(*)=2 FROM "{table}")',f'(SELECT count(*)=2 FROM "{table}" WHERE id IN ({fixture_ids}))')
    tests=tests.replace(f'FROM "{table}" WHERE "archivedAt" IS NOT NULL',f'FROM "{table}" WHERE id IN ({fixture_ids}) AND "archivedAt" IS NOT NULL')
tests=tests.replace('"opportunityId"=-1','"opportunityId"=-2099998500').replace('"createdById"=-1','"createdById"=-2099998500')
tests=tests.replace("'second@example.invalid'",f"'{prefix}_second@example.invalid'")
tests=tests.replace("'fixture-subject'",f"'{prefix}_subject'")
identity_id=[base+300]
def explicit_identity(match):
    identity_id[0]+=1
    return 'INSERT INTO "ExternalIdentity"(id,"userId",issuer,subject,"updatedAt") VALUES('+str(identity_id[0])+','
tests=re.sub(r'INSERT INTO "ExternalIdentity"\("userId",issuer,subject,"updatedAt"\) VALUES\(',explicit_identity,tests)
assert identity_id[0]==base+304
# Quiet output before fixture creation, then run unchanged assertion functions.
tests=tests.replace('BEGIN;\n\\o /dev/null','BEGIN;\n\\o /dev/null\n'+prelude,1)
assert tests.count('BEGIN;')==1 and tests.rstrip().endswith('ROLLBACK;')
assert 'COMMIT;' not in tests
result=subprocess.run(['docker','compose','exec','-T','db','sh','-c',
  'exec psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d bixolon_crm'],
  cwd=ROOT,input=tests,text=True,capture_output=True)
if result.returncode:
    print(result.stdout)
    print(result.stderr)
    raise SystemExit('Live integrity verification failed; transaction rolled back.')
print(result.stdout)
print('PASS: live integrity suite used collision-checked negative fixture IDs and rolled back; no sequence IDs consumed.')
