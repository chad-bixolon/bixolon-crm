import { PrismaClient, type UserRole } from '@prisma/client';
import { test, expect } from './fixtures';
import { databaseUrl, emails } from './constants.mjs';
import { signInAs, uniqueName } from './helpers';
import { saveUser } from '../lib/users';
import { assertTaskEdit } from '../lib/task-policy';
import { saveTask, type TaskInput } from '../lib/work';
import { bulkTasks } from '../lib/bulk-actions';
import { saveSupportCaseTask } from '../lib/support-work';
import { notificationPage } from '../lib/notifications';

const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const user = (role: keyof typeof emails) => db.user.findUniqueOrThrow({ where: { email: emails[role] } });
test.afterAll(() => db.$disconnect());

test('individual and bulk Task responsibility/Project scope agree against persisted records', async () => {
  const sales = await user('sales'), manager = await user('salesManager'), admin = await user('admin');
  const project = await db.project.create({ data: { name: uniqueName('Policy Project'), ownerId: manager.id, createdById: admin.id, primaryAccountRole: 'PROGRAM_OWNER' } });
  const account = await db.account.create({ data: { name:uniqueName('Policy Account'), ownerId:sales.id } });
  const supportCase = await db.supportCase.create({ data: { caseNumber: uniqueName('POLICY'), subject:'Policy Task case', accountId:account.id, customerNameText:'Customer', description:'Case work', source:'PHONE', createdById:admin.id, updatedById:admin.id } });
  for (const [assignedToId, projectId, supportCaseId, allowed] of [
    [sales.id,null,null,true], [manager.id,null,null,false], [null,null,null,false],
    [sales.id,project.id,null,false], [sales.id,null,supportCase.id,true], [manager.id,null,supportCase.id,false],
  ] as const) {
    const row = await db.task.create({ data: { subject:uniqueName('Policy Task'), assignedToId, projectId, supportCaseId, accountId:supportCaseId ? account.id : null } });
    const value: TaskInput = { subject:row.subject, description:null, accountId:supportCaseId ? account.id : null, opportunityId:null, projectId, supportCaseId, contactId:null, assignedToId, dueDate:null, status:'OPEN', priority:'NORMAL' };
    const request = { records:[{id:row.id,updatedAt:row.updatedAt.toISOString()}], action:'complete', value:'', confirmed:true };
    if (allowed) {
      await assertTaskEdit(db,sales,row.id);
      await saveTask(db,value,row.id,undefined,sales.id,row.updatedAt.toISOString(),sales);
      const latest=await db.task.findUniqueOrThrow({where:{id:row.id}});
      await bulkTasks(db,sales,{...request,records:[{id:row.id,updatedAt:latest.updatedAt.toISOString()}]});
    } else {
      await expect(saveTask(db,value,row.id,undefined,sales.id,row.updatedAt.toISOString(),sales)).rejects.toThrow(/unavailable/);
      await expect(bulkTasks(db,sales,request)).rejects.toThrow(/changed|unavailable/);
      expect((await db.task.findUniqueOrThrow({where:{id:row.id}})).status).toBe('OPEN');
    }
  }
});

test('Support case reassignment sends visible notices and preserves collaborative case work without general Task eligibility', async ({ page }) => {
  const admin=await user('admin'), support=await user('support');
  const supportCase=await db.supportCase.create({data:{caseNumber:uniqueName('ELIGIBILITY'),subject:'Support eligibility',description:'Work',customerNameText:'Customer',source:'PHONE',createdById:admin.id,updatedById:admin.id}});
  const unavailable=await db.user.create({data:{email:uniqueName('inactive').replaceAll(' ','')+'@example.test',firstName:'Inactive',lastName:'Support',role:'SUPPORT',active:false}});
  const task=await db.task.create({data:{subject:uniqueName('Case eligibility Task'),supportCaseId:supportCase.id,assignedToId:unavailable.id,createdById:admin.id}});
  await signInAs(page,'admin');
  await page.goto('/administration/ownership?entity=Task');
  await expect(page.getByRole('option',{name:`${support.firstName} ${support.lastName}`,exact:true})).toHaveCount(1);
  await bulkTasks(db,admin,{records:[{id:task.id,updatedAt:task.updatedAt.toISOString()}],action:'assign',value:String(support.id),confirmed:true});
  const assigned=await db.task.findUniqueOrThrow({where:{id:task.id}});
  expect(await db.notification.count({where:{entityType:'TASK',entityId:task.id,userId:support.id,type:'TASK_ASSIGNED'}})).toBe(1);
  const notices=await notificationPage(db,support,'all');
  expect(notices.rows.some(item=>item.entityId===task.id&&item.entityType==='TASK')).toBe(true);
  await saveSupportCaseTask(db,support,{subject:assigned.subject,description:null,accountId:null,opportunityId:null,projectId:null,supportCaseId:supportCase.id,contactId:null,assignedToId:support.id,dueDate:null,status:'COMPLETED',priority:'NORMAL'},task.id,assigned.updatedAt.toISOString());
  const general=await db.task.create({data:{subject:'General eligibility',assignedToId:admin.id}});
  await expect(bulkTasks(db,admin,{records:[{id:general.id,updatedAt:general.updatedAt.toISOString()}],action:'assign',value:String(support.id),confirmed:true})).rejects.toThrow(/eligible/);
  expect((await db.task.findUniqueOrThrow({where:{id:general.id}})).assignedToId).toBe(admin.id);
});

test('final usable Admin guard serializes concurrent removals in the isolated E2E database', async () => {
  // Only this local fixture database is touched. Restore seeded Admins in finally.
  const admins=await db.user.findMany({where:{role:'ADMIN',active:true,archivedAt:null}});
  const createAdmin=async()=>db.user.create({data:{email:uniqueName('guard').replaceAll(' ','')+'@example.test',firstName:'Guard',lastName:'Admin',role:'ADMIN'}});
  const a=await createAdmin(), b=await createAdmin();
  try {
    await db.user.updateMany({where:{id:{in:admins.map(u=>u.id)}},data:{active:false}});
    const input=(role:UserRole,email:string)=>({firstName:'Guard',lastName:'Admin',email,role,active:true});
    const results=await Promise.allSettled([saveUser(db,a,input('SALES',a.email),a.id),saveUser(db,b,input('SALES',b.email),b.id)]);
    expect(results.filter(r=>r.status==='fulfilled'), results.map(r=>r.status==='rejected'?String(r.reason):'saved').join(' / ')).toHaveLength(1);
    expect(results.filter(r=>r.status==='rejected')).toHaveLength(1);
    const rejected=results.find(r=>r.status==='rejected') as PromiseRejectedResult;
    expect(rejected.reason.message).toMatch(/Keep at least one active/);
    expect(await db.user.count({where:{role:'ADMIN',active:true,archivedAt:null}})).toBe(1);
  } finally {
    await db.user.updateMany({where:{id:{in:admins.map(u=>u.id)}},data:{active:true}});
    await db.user.deleteMany({where:{id:{in:[a.id,b.id]}}});
  }
});

test('authorized Admin can create and update users through the existing form', async ({ page }) => {
  const email=uniqueName('new-policy-user').replaceAll(' ','')+'@example.test';
  await signInAs(page,'admin');
  await page.goto('/administration/users/new');
  await page.getByLabel('First name').fill('Policy');
  await page.getByLabel('Last name').fill('User');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Role').selectOption('SUPPORT');
  await page.getByRole('button',{name:'Create user',exact:true}).click();
  await expect(page.getByRole('status')).toHaveText('User created successfully.');
  await page.getByLabel('Status',{exact:true}).selectOption('false');
  await page.getByRole('button',{name:'Save user',exact:true}).click();
  await expect(page.getByRole('status')).toHaveText('User updated successfully.');
  const saved=await db.user.findUniqueOrThrow({where:{email}});
  expect(saved.active).toBe(false); expect(saved.role).toBe('SUPPORT');
  expect(await db.externalIdentity.count({where:{userId:saved.id}})).toBe(0);
});

test('Support receives catalog HTML without negotiated prices; entitled readers retain them', async ({ page }) => {
  const account=await db.account.create({data:{name:uniqueName('Pricing Customer')}});
  const part=uniqueName('POLICY-SKU');
  const product=await db.product.create({data:{name:uniqueName('Pricing Product'),sku:part}});
  const sku=await db.productSku.create({data:{productId:product.id,partNumber:part,normalizedPartNumber:part.toUpperCase(),catalogSource:'ODM',odmSubtype:'CUSTOMER_SPECIFIC',odmCustomers:{create:{accountId:account.id,prices:{create:{currencyCode:'USD',customerPrice:987.65,previousPrice:876.54,tariffPercent:25,tariffAmount:246.91,finalUnitPrice:1234.56,notes:'PRIVATE_NEGOTIATED_POLICY_NOTE',sourceType:'MANUAL'}}}}}});
  await db.productPrice.create({data:{skuId:sku.id,tier:'STANDARD',currencyCode:'USD',amount:10}});
  await signInAs(page,'support');
  const response=await page.goto(`/products/${product.id}`);
  const html=await response!.text();
  await expect(page.getByRole('heading',{name:product.name,exact:true})).toBeVisible();
  expect(html).toContain(account.name);
  expect(html).not.toMatch(/987\.65|876\.54|246\.91|1234\.56|PRIVATE_NEGOTIATED_POLICY_NOTE|Customer Price|Previous Price|Final Unit Price|Pricing Notes|Tariff Amount/);
  for(const role of ['sales','readOnly'] as const){
    await signInAs(page,role);
    await page.goto(`/products/${product.id}`);
    await expect(page.getByText('PRIVATE_NEGOTIATED_POLICY_NOTE',{exact:true})).toBeVisible();
  }
});

test('case Task edit links follow record policy for Sales, Admin and Support', async ({ page }) => {
  const sales=await user('sales'), manager=await user('salesManager'), admin=await user('admin'), support=await user('support');
  const account=await db.account.create({data:{name:uniqueName('Task link Account'),ownerId:sales.id}});
  const supportCase=await db.supportCase.create({data:{caseNumber:uniqueName('TASK-LINK'),subject:'Task link policy',description:'Work',accountId:account.id,source:'PHONE',createdById:admin.id,updatedById:admin.id}});
  const makeTask=(subject:string,assignedToId:number|null,createdById:number)=>db.task.create({data:{subject:uniqueName(subject),accountId:account.id,supportCaseId:supportCase.id,assignedToId,createdById}});
  const own=await makeTask('Assigned Sales work',sales.id,admin.id);
  const unassigned=await makeTask('Unassigned Sales creator',null,sales.id);
  const foreign=await makeTask('Another rep work',manager.id,admin.id);
  const supportWork=await makeTask('Unassigned Support creator',null,support.id);
  for(const role of ['sales','admin','support'] as const){
    await signInAs(page,role);
    await page.goto(`/support/cases/${supportCase.id}`);
    const tasks=page.getByRole('region',{name:'Case Tasks'});
    for(const task of [own,unassigned,foreign,supportWork]){
      await expect(tasks.getByRole('link',{name:task.subject,exact:true})).toBeVisible();
      const editable=role==='admin'||(role==='sales'&&task.id===own.id)||(role==='support'&&task.id===supportWork.id);
      await expect(tasks.locator(`a[href="/tasks/${task.id}/edit"]`)).toHaveCount(editable?1:0);
    }
    const target=role==='support'?supportWork:unassigned;
    await page.goto(`/tasks/${target.id}`);
    await expect(page.locator(`a[href="/tasks/${target.id}/edit"]`)).toHaveCount(role==='sales'?0:1);
    if(role==='sales')expect((await page.request.get(`/tasks/${target.id}/edit`)).status()).toBe(404);
  }
});
