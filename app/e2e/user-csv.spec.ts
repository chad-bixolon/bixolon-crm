import { PrismaClient } from '@prisma/client';
import { test, expect } from './fixtures';
import { signInAs } from './helpers';
import { databaseUrl, emails } from './constants.mjs';
import { reviewUserCsv, applyUserCsv, signUserCsvPreview } from '../lib/user-csv';
const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
test.afterAll(() => db.$disconnect());
const header = 'First Name,Last Name,Email,Role,Active,Timezone\n';
for (const width of [1440,1024,820,768,390]) test(`user CSV preview, apply and filtered export at ${width}px`, async ({page}) => {
  await page.setViewportSize({width,height:900});
  await signInAs(page,'admin');
  await page.goto('/administration/users');
  await page.getByRole('link',{name:'Import users',exact:true}).click();
  const email = `csv-${width}-${Date.now()}@example.test`;
  await page.getByLabel('CSV file').setInputFiles({name:'users.csv',mimeType:'text/csv',buffer:Buffer.from(header+`민준,김,${email},EXECUTIVE,yes,Asia/Seoul\n`)});
  await page.getByRole('button',{name:'Upload and preview'}).click();
  await expect(page.getByRole('heading',{name:'Review changes'})).toBeVisible();
  await expect(page.getByRole('cell',{name:'Create',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBeTruthy();
  await page.getByRole('checkbox').check();
  await page.getByRole('button',{name:'Confirm and import users'}).click();
  await expect(page.getByRole('heading',{name:'Import results'})).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Import completed');
  const user = await db.user.findUniqueOrThrow({where:{email}});
  expect(user.firstName).toBe('민준');expect(user.timeZone).toBe('Asia/Seoul');
  expect(await db.externalIdentity.count({where:{userId:user.id}})).toBe(0);
  expect(await db.adminMaintenanceEvent.count({where:{entityType:'User',recordIds:{has:user.id},action:'User created'}})).toBe(1);
  await page.goto('/administration/users?visibility=archived');
  const response = await page.request.get('/administration/users/export?visibility=archived');
  expect(response.headers()['content-type']).toContain('text/csv');
  expect(await response.text()).not.toContain(email);
  await expect(page.getByRole('link',{name:'Export users (archived)'})).toBeVisible();
});
test('CSV errors prevent confirmation; unauthorized direct routes are denied',async({page})=>{
 await signInAs(page,'admin');await page.goto('/administration/users/import');
 await page.getByLabel('CSV file').setInputFiles({name:'invalid.csv',mimeType:'text/csv',buffer:Buffer.from(header+'A,B,invalid@example.test,UNKNOWN,maybe,Mars/City\n')});
 await page.getByRole('button',{name:'Upload and preview'}).click();
 await expect(page.getByRole('cell',{name:'Error',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Confirm and import users'})).toHaveCount(0);
 for(const role of ['sales','salesManager','support','supportManager','executive','marketing','readOnly'] as const){
  await signInAs(page,role);await page.goto('/administration/users/import');await expect(page).toHaveURL(/access-denied/);
  const response=await page.request.get('/administration/users/export');expect(response.url()).toContain('access-denied');
 }
});
test('database atomic rollback keeps user and history unchanged when a later row fails',async()=>{
 process.env.AUTH_SECRET='csv-e2e-service-signing-only';
 const admin=await db.user.findUniqueOrThrow({where:{email:emails.admin}});
 const email=`atomic-${Date.now()}@example.test`, csv=header+`A,B,${email},SALES,true,UTC\nC,D,second-${email},SUPPORT,true,UTC\n`;
 const preview=await reviewUserCsv(db,admin,csv);
 // Run the real transaction and force failure after the first row has persisted.
 const failing=db.$extends({query:{user:{async create({args,query}){if(args.data.email===`second-${email}`)throw new Error('injected second-row failure');return query(args);}}}});
 await expect(applyUserCsv(failing as unknown as PrismaClient,admin,csv,signUserCsvPreview(admin.id,preview.digest))).rejects.toThrow('injected second-row failure');
 expect(await db.user.count({where:{email}})).toBe(0);
});
