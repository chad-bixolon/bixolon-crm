import { test, expect } from './fixtures';
import { Prisma, PrismaClient, type UserRole } from '@prisma/client';
import { signInAs } from './helpers';
import { baseURL, databaseUrl, emails, names } from './constants.mjs';

const db=new PrismaClient({datasources:{db:{url:databaseUrl}}});
const compositions:{login:keyof typeof emails;role:UserRole;keys:string[]}[]=[
  {login:'sales',role:'SALES',keys:['MY_DAY','OVERDUE_TASKS','CLOSING_OPPORTUNITIES','FORECAST_SUMMARY','PIPELINE_BY_STAGE','FORECAST_ATTENTION','MY_TRADE_SHOW_LEADS','RECENT_ACTIVITY']},
  {login:'salesManager',role:'SALES_MANAGER',keys:['FORECAST_SUMMARY','PIPELINE_BY_REP','PIPELINE_BY_STAGE','CLOSING_OPPORTUNITIES','FORECAST_ATTENTION','RECENT_ACTIVITY','FORECAST_MOVEMENT','OVERDUE_TASKS','MY_DAY']},
  {login:'support',role:'SUPPORT',keys:['SUPPORT_MY_OPEN','SUPPORT_INTAKE','SUPPORT_PRIORITY','SUPPORT_OVERDUE','SUPPORT_TASKS','SUPPORT_OLDEST','SUPPORT_ACTIVITY']},
  {login:'admin',role:'ADMIN',keys:['ADMIN_DATA_QUALITY','ADMIN_HEALTH','ADMIN_SHORTCUTS']},
  {login:'marketing',role:'MARKETING_MANAGER',keys:['MARKETING_ACTIVITY','MARKETING_SUMMARY','OVERDUE_TASKS']},
  {login:'readOnly',role:'READ_ONLY',keys:['FORECAST_SUMMARY','PIPELINE_BY_STAGE']},
];

test.afterAll(async()=>{
  // Also clean fixtures if a setup assertion failed before its per-test finally.
  try{
    const leftovers=await db.supportCase.findMany({where:{caseNumber:{startsWith:'DASH-'},subject:'Dashboard Support work',customerNameText:'Dashboard test customer'},select:{id:true}});
    const ids=leftovers.map(row=>row.id);
    if(ids.length){
      await db.activity.deleteMany({where:{supportCaseId:{in:ids}}});
      await db.task.deleteMany({where:{supportCaseId:{in:ids}}});
      await db.supportCase.deleteMany({where:{id:{in:ids}}});
    }
  }finally{await db.$disconnect();}
});

for(const audience of compositions)test(`${audience.role} composition and desktop/tablet/phone layout`,async({page},testInfo)=>{
  const user=await db.user.findUniqueOrThrow({where:{email:emails[audience.login]}});
  const personal=await db.userDashboardLayout.findUnique({where:{userId:user.id}});
  const roleLayout=await db.roleDashboardLayout.findUnique({where:{role:audience.role}});
  await db.userDashboardLayout.deleteMany({where:{userId:user.id}});
  await db.roleDashboardLayout.deleteMany({where:{role:audience.role}});
  try{
    await signInAs(page,audience.login);
    for(const width of [1440,768,390]){
      await page.setViewportSize({width,height:900});
      await page.goto('/');
      await expect(page.locator('[data-dashboard-widget]')).toHaveCount(audience.keys.length);
      expect(await page.locator('[data-dashboard-widget]').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('data-dashboard-widget')))).toEqual(audience.keys);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
      await expect(page.getByRole('button',{name:'Recent Items',exact:true})).toBeVisible();
      await page.screenshot({path:testInfo.outputPath(`${audience.role}-${width}.png`),fullPage:true});
    }
    if(audience.role==='SUPPORT'){
      await expect(page.getByRole('main')).not.toContainText('Forecast');
      await expect(page.getByRole('main')).not.toContainText('Pipeline');
      await expect(page.getByRole('main')).not.toContainText('Marketing');
      expect((await page.request.get('/pipeline',{maxRedirects:0})).headers().location).toContain('/access-denied');
      expect((await page.request.get('/administration',{maxRedirects:0})).headers().location).toContain('/access-denied');
    }
    if(audience.role==='ADMIN'){
      await expect(page.getByRole('main').getByRole('link',{name:'View Data Quality / Cleanup'})).toHaveAttribute('href','/administration/data-quality');
      await expect(page.getByRole('main').getByRole('link',{name:'View System Health'})).toHaveAttribute('href','/administration/system-health');
    }
    if(audience.role==='MARKETING_MANAGER'){
      await page.getByRole('link',{name:'Lead sources',exact:true}).click();
      await expect(page).toHaveURL('/reports/lead-sources');
      await expect(page.locator('main h1')).toBeVisible();
      await page.goto('/');
      await page.getByRole('link',{name:'Campaign attribution',exact:true}).click();
      await expect(page).toHaveURL('/reports/marketing-attribution');
    }
    if(audience.role==='READ_ONLY'){
      await expect(page.getByRole('link',{name:'Customize Dashboard'})).toHaveCount(0);
      await expect(page.getByRole('navigation',{name:'Quick Create'})).toHaveCount(0);
      expect(await page.locator('main a[href$="/new"], main a[href$="/edit"], main a[href^="/reports/new"]').count()).toBe(0);
      expect((await page.request.get('/opportunities/new',{maxRedirects:0})).headers().location).toContain('/access-denied');
    }
  }finally{
    await db.userDashboardLayout.deleteMany({where:{userId:user.id}});
    if(personal)await db.userDashboardLayout.create({data:{...personal,configuration:personal.configuration??Prisma.JsonNull}});
    if(roleLayout)await db.roleDashboardLayout.create({data:{...roleLayout,configuration:roleLayout.configuration??Prisma.JsonNull}});
  }
});

test('role change drops a prior-role personal layout',async({page})=>{
  const user=await db.user.findUniqueOrThrow({where:{email:emails.sales}});
  const personal=await db.userDashboardLayout.findUnique({where:{userId:user.id}});
  await db.userDashboardLayout.upsert({where:{userId:user.id},create:{userId:user.id,role:'SALES',configuration:{version:1,items:[{kind:'BUILTIN',key:'FORECAST_SUMMARY',size:'FULL'}]}},update:{role:'SALES',configuration:{version:1,items:[{kind:'BUILTIN',key:'FORECAST_SUMMARY',size:'FULL'}]}}});
  try{
    await signInAs(page,'sales');
    await expect(page.locator('[data-dashboard-widget="FORECAST_SUMMARY"]')).toBeVisible();
    await db.user.update({where:{id:user.id},data:{role:'SUPPORT'}});
    await page.reload();
    await expect(page.locator('[data-dashboard-widget="SUPPORT_MY_OPEN"]')).toBeVisible();
    await expect(page.locator('[data-dashboard-widget="FORECAST_SUMMARY"]')).toHaveCount(0);
  }finally{
    await db.user.update({where:{id:user.id},data:{role:user.role}});
    await db.userDashboardLayout.deleteMany({where:{userId:user.id}});
    if(personal)await db.userDashboardLayout.create({data:{...personal,configuration:personal.configuration??Prisma.JsonNull}});
  }
});

test('impersonation uses effective-role composition and returns to Admin',async({page,context})=>{
  test.skip(process.env.ENABLE_DEV_IMPERSONATION!=='true','Development impersonation is disabled');
  const support=await db.user.findUniqueOrThrow({where:{email:emails.support}});
  await signInAs(page,'admin');
  await context.addCookies([{name:'saleshub-dev-impersonate-user',value:String(support.id),url:baseURL}]);
  await page.reload();
  await expect(page.locator('[data-dashboard-widget="SUPPORT_MY_OPEN"]')).toBeVisible();
  await expect(page.locator('[data-dashboard-widget="ADMIN_HEALTH"]')).toHaveCount(0);
  await page.getByRole('button',{name:'Return to Admin'}).click();
  await expect(page.locator('[data-dashboard-widget="ADMIN_HEALTH"]')).toBeVisible();
});

for(const audience of compositions)test(`${audience.role} intentional empty layout is quiet`,async({page})=>{
  const user=await db.user.findUniqueOrThrow({where:{email:emails[audience.login]}});
  const personal=await db.userDashboardLayout.findUnique({where:{userId:user.id}});
  await db.userDashboardLayout.upsert({where:{userId:user.id},create:{userId:user.id,role:audience.role,configuration:{version:1,items:[]}},update:{role:audience.role,configuration:{version:1,items:[]}}});
  try{
    await signInAs(page,audience.login);
    await expect(page.getByRole('main')).toContainText('No Dashboard widgets are selected.');
    await expect(page.locator('[data-dashboard-widget]')).toHaveCount(0);
    await expect(page.locator('main h2')).toHaveCount(0);
    if(audience.role==='READ_ONLY')await expect(page.getByRole('link',{name:'Customize Dashboard'})).toHaveCount(0);
  }finally{
    await db.userDashboardLayout.deleteMany({where:{userId:user.id}});
    if(personal)await db.userDashboardLayout.create({data:{...personal,configuration:personal.configuration??Prisma.JsonNull}});
  }
});

test('cross-section keyboard ordering persists and matches phone stacking',async({page})=>{
  const user=await db.user.findUniqueOrThrow({where:{email:emails.sales}});
  const personal=await db.userDashboardLayout.findUnique({where:{userId:user.id}});
  const items=[{kind:'BUILTIN',key:'MY_DAY',size:'HALF'},{kind:'BUILTIN',key:'FORECAST_SUMMARY',size:'FULL'},{kind:'BUILTIN',key:'OVERDUE_TASKS',size:'HALF'}];
  await db.userDashboardLayout.upsert({where:{userId:user.id},create:{userId:user.id,role:'SALES',configuration:{version:1,items}},update:{role:'SALES',configuration:{version:1,items}}});
  try{
    await signInAs(page,'sales');
    await page.getByRole('link',{name:'Customize Dashboard'}).click();
    const move=page.getByRole('button',{name:'Move Tasks Needing Attention up',exact:true});
    await move.focus();
    await page.keyboard.press('Enter');
    await page.getByRole('button',{name:'Save Dashboard',exact:true}).click();
    await expect(page.getByRole('status')).toContainText('Dashboard updated.');
    await expect.poll(async()=>{const saved=await db.userDashboardLayout.findUniqueOrThrow({where:{userId:user.id}});return (saved.configuration as {items:{key:string}[]}).items.map(item=>item.key);}).toEqual(['MY_DAY','OVERDUE_TASKS','FORECAST_SUMMARY']);
    await page.setViewportSize({width:390,height:844});
    await page.reload();
    expect(await page.locator('[data-dashboard-widget]').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('data-dashboard-widget')))).toEqual(['MY_DAY','OVERDUE_TASKS','FORECAST_SUMMARY']);
    const cards=await page.locator('[data-dashboard-widget]').all();
    const positions=await Promise.all(cards.map(card=>card.boundingBox()));
    expect(positions[0]!.y).toBeLessThan(positions[1]!.y);
    expect(positions[1]!.y).toBeLessThan(positions[2]!.y);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  }finally{
    await db.userDashboardLayout.deleteMany({where:{userId:user.id}});
    if(personal)await db.userDashboardLayout.create({data:{...personal,configuration:personal.configuration??Prisma.JsonNull}});
  }
});

test('Support assigned cases, due-soon Tasks and activity links use real case data',async({page})=>{
  const user=await db.user.findUniqueOrThrow({where:{email:emails.support}});
  const stamp=`DASH-${Date.now()}`;
  const account=await db.account.findFirstOrThrow({where:{name:names.account}});
  const supportCase=await db.supportCase.create({data:{caseNumber:stamp,customerNameText:'Dashboard test customer',subject:'Dashboard Support work',description:'Browser fixture',source:'OTHER',accountId:account.id,assignedToId:user.id,createdById:user.id,updatedById:user.id,status:'WAITING_ON_INTERNAL'}});
  const task=await db.task.create({data:{subject:`Follow up ${stamp}`,assignedToId:user.id,accountId:account.id,supportCaseId:supportCase.id,dueDate:new Date(Date.now()+86400000)}});
  const type=await db.activityType.findFirstOrThrow({where:{active:true}});
  const activity=await db.activity.create({data:{subject:`Support update ${stamp}`,type:type.code,accountId:account.id,supportCaseId:supportCase.id,userId:user.id}});
  try{
    await signInAs(page,'support');
    await expect(page.locator('[data-dashboard-widget="SUPPORT_MY_OPEN"]')).toContainText('Waiting on Internal');
    await expect(page.locator('[data-dashboard-widget="SUPPORT_TASKS"]').getByRole('link',{name:task.subject})).toHaveAttribute('href',`/tasks/${task.id}`);
    await expect(page.locator('[data-dashboard-widget="SUPPORT_ACTIVITY"]')).toContainText(activity.subject);
    await page.locator('[data-dashboard-widget="SUPPORT_ACTIVITY"]').getByRole('link',{name:stamp,exact:true}).click();
    await expect(page).toHaveURL(`/support/cases/${supportCase.id}`);
    await db.supportCase.update({where:{id:supportCase.id},data:{archivedAt:new Date()}});
    await page.goto('/');
    await expect(page.locator('[data-dashboard-widget="SUPPORT_TASKS"]')).not.toContainText(task.subject);
    await expect(page.locator('[data-dashboard-widget="SUPPORT_ACTIVITY"]')).not.toContainText(activity.subject);
  }finally{
    await db.recentItem.deleteMany({where:{userId:user.id,recordId:supportCase.id,entityType:'SUPPORT_CASE'}});
    await db.activity.delete({where:{id:activity.id}});
    await db.task.delete({where:{id:task.id}});
    await db.supportCase.delete({where:{id:supportCase.id}});
  }
});

test('personal Sales and Support widgets explain empty work without unrelated metrics',async({page})=>{
  for(const role of ['SALES','SUPPORT'] as const){
    const user=await db.user.create({data:{firstName:'Empty',lastName:role,email:`dashboard-empty-${role}-${Date.now()}@e2e.saleshub.local`,role}});
    const keys=role==='SALES'?['MY_DAY','OVERDUE_TASKS']:['SUPPORT_MY_OPEN','SUPPORT_TASKS'];
    await db.userDashboardLayout.create({data:{userId:user.id,role,configuration:{version:1,items:keys.map(key=>({kind:'BUILTIN',key,size:'HALF'}))}}});
    try{
      const csrf=await page.request.get('/api/auth/csrf');
      const {csrfToken}=await csrf.json();
      const auth=await page.request.post('/api/auth/callback/e2e',{form:{csrfToken,email:user.email,token:'saleshub-local-e2e-only',callbackUrl:'/'},maxRedirects:0});
      expect(auth.status()).toBe(302);
      await page.goto('/');
      if(role==='SALES'){
        await expect(page.getByRole('main')).toContainText('No meetings, Activities, or Tasks for today.');
        await expect(page.getByRole('main')).toContainText('No overdue Tasks or Tasks due in the next 7 days.');
      }else{
        await expect(page.getByRole('main')).toContainText('No open Support Cases assigned to you.');
        await expect(page.getByRole('main')).toContainText('No Support Tasks due in the next 7 days or overdue.');
      }
      await expect(page.locator('[data-dashboard-widget]')).toHaveCount(2);
    }finally{
      await db.userDashboardLayout.delete({where:{userId:user.id}});
      await db.user.delete({where:{id:user.id}});
    }
  }
});
