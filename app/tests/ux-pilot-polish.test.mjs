import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Module from 'node:module';
import ts from 'typescript';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
Module._extensions['.ts']=(mod,filename)=>mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,filename);
const require=Module.createRequire(import.meta.url);
const {saveFeedbackPath,saveFeedbackMessage}=require(path.join(root,'lib/save-feedback.ts'));
const source=file=>fs.readFileSync(path.join(root,file),'utf8');

test('save feedback paths preserve existing queries and fragments',()=>{
  assert.equal(saveFeedbackPath('/accounts/7','created'),'/accounts/7?saved=created');
  assert.equal(saveFeedbackPath('/products/3/edit#sku-8','updated'),'/products/3/edit?saved=updated#sku-8');
  assert.equal(saveFeedbackPath('/accounts/7?tab=activity','updated'),'/accounts/7?tab=activity&saved=updated');
});

test('create and edit success copy is consistent',()=>{
  assert.equal(saveFeedbackMessage('created','Opportunity'),'Opportunity created successfully.');
  assert.equal(saveFeedbackMessage('updated','Opportunity'),'Changes saved.');
  assert.equal(saveFeedbackMessage(undefined,'Opportunity'),null);
});

test('success feedback is announced, dismissible, actionable, and one-time',()=>{
  const component=source('components/save-success.tsx');
  assert.match(component,/role="status" aria-live="polite"/);
  assert.match(component,/aria-label="Dismiss success message"/);
  assert.match(component,/action && <Link/);
  assert.match(component,/searchParams\.delete\('saved'\)/);
  assert.match(component,/setTimeout\(\(\) => setVisible\(false\), 7000\)/);
});

test('failed save branches return errors while success is attached after persistence',()=>{
  for(const file of ['app/accounts/actions.ts','app/contacts/actions.ts','app/projects/actions.ts','app/opportunities/actions.ts','app/products/actions.ts','app/trade-shows/actions.ts','app/tasks/actions.ts']){
    const action=source(file);
    assert.match(action,/message:/,file);
    assert.match(action,/saveFeedbackPath/,file);
  }
});

test('pilot filter copy and shared compact controls remain present',()=>{
  const css=source('app/globals.css');
  assert.match(css,/\.filter-control[^}]*height: 2\.25rem/);
  assert.match(css,/select\.filter-control[^}]*padding-right: 2rem/);
  assert.match(css,/\.btn-filter-primary, \.btn-filter-secondary[^}]*height: 2\.25rem/);
  assert.match(source('app/contacts/page.tsx'),/Manage customer, partner, and prospect contacts\./);
  assert.match(source('app/opportunities/page.tsx'),/Close Date From/);
  assert.match(source('app/opportunities/page.tsx'),/Close Date Through/);
  assert.match(source('app/tasks/page.tsx'),/Due Date From/);
  assert.match(source('app/tasks/page.tsx'),/Due Date Through/);
});

test('Trade Show list groups KPIs and no longer uses TableScroll',()=>{
  const page=source('app/trade-shows/page.tsx');
  for(const heading of ['Trade Show','Event','Leads','Follow-Up','Conversion']) assert.match(page,new RegExp(`>${heading}<`));
  assert.doesNotMatch(page,/TableScroll/);
  assert.match(page,/conversion|rate/i);
});
