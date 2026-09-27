import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const workflow=fs.readFileSync(path.join(import.meta.dirname,'../app/administration/imports/products/workflow.tsx'),'utf8');
const catalog=fs.readFileSync(path.join(import.meta.dirname,'../app/administration/imports/products/catalog-batch-review.tsx'),'utf8');

test('ODM import explains Account matching and shows existing Account types without editing them',()=>{
  assert.match(workflow,/Match each customer from the workbook to a CRM Account/);
  assert.match(workflow,/Matched to existing Account:/);
  assert.match(workflow,/Archived Account found:/);
  assert.match(workflow,/Existing Account found but inactive:/);
  assert.match(workflow,/!missing\?accountRecords\.find\(account=>account\.id===customer\.accountId\)\?\.businessRoles/);
  assert.match(workflow,/Not specified/);
  assert.doesNotMatch(workflow,/select or reactivate it/);
});

test('resolved row values offer Change instead of showing every decision control',()=>{
  assert.match(workflow,/item\.after\.odmCustomerAccountId&&!editing\[`row-account:/);
  assert.match(workflow,/!priceGroups\.some\(group=>group\.reviewKeys\.includes\(key\)\)&&!editing\[`price:/);
  assert.match(workflow,/!tariffGroups\.some\(group=>group\.reviewKeys\.includes\(key\)\)&&!editing\[`tariff:/);
  assert.match(workflow,/item\.productId&&!editing\[`product:/);
  assert.match(workflow,/item\.skuId&&!editing\[`sku:/);
  assert.match(workflow,/source\?\.note&&notePrice\(source\.note\)&&\(priceGroups/);
  assert.match(workflow,/Price mentioned in Notes/);
  assert.match(workflow,/Import action/);
});

test('Product and SKU review uses business labels and subtype explanations',()=>{
  for(const label of ['CRM Product','CRM SKU','SKU to use','Price to use','Tariff to use','Customer-Specific: This SKU is intended for a specific customer.','Special Configuration: This SKU is customized but may be sold to multiple customers.']) assert.match(workflow,label.includes(':')?new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')):new RegExp(label));
  assert.match(catalog,/Standard SKU this customized SKU is based on/);
  assert.doesNotMatch(workflow,/\(#\$\{/);
  assert.doesNotMatch(catalog,/\(#\$\{/);
});
