import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
Module._extensions['.ts']=(mod,filename)=>mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,filename);
const require=Module.createRequire(import.meta.url);
const {Prisma}=require('@prisma/client');
const {calculateOdmCustomerPrice,parseOdmPriceForm}=require(path.join(root,'lib/odm-customer-pricing.ts'));
const {matchingOdmCustomers}=require(path.join(root,'lib/catalog-picker.ts'));
const {odmCustomerSnapshot}=require(path.join(root,'lib/opportunity-odm-pricing.ts'));

test('tariff percentage, amount, no tariff, final price and half-up rounding use Decimal',()=>{
  const percent=calculateOdmCustomerPrice({customerPrice:'19.99',tariffPercent:'12.5',currencyCode:'USD'});
  assert.deepEqual([percent.tariffAmount,percent.finalUnitPrice,percent.tariffPercent],['2.50','22.49','12.5000']);
  const amount=calculateOdmCustomerPrice({customerPrice:'80.00',tariffAmount:'10.00',currencyCode:'USD'});
  assert.equal(amount.tariffPercent,'12.5000');assert.equal(amount.finalUnitPrice,'90.00');
  const none=calculateOdmCustomerPrice({customerPrice:'10.01',previousPrice:'11.00',currencyCode:'USD'});
  assert.deepEqual([none.previousPrice,none.tariffPercent,none.tariffAmount,none.finalUnitPrice],['11.00','0.0000','0.00','10.01']);
  assert.equal(calculateOdmCustomerPrice({customerPrice:'0.05',tariffPercent:'10',currencyCode:'USD'}).tariffAmount,'0.01');
  assert.equal(calculateOdmCustomerPrice({customerPrice:'0.10',tariffAmount:'0.01',currencyCode:'USD'}).tariffPercent,'10.0000');
});

test('supplied tariff values retain one-cent variance and flag material disagreement',()=>{
  assert.equal(calculateOdmCustomerPrice({customerPrice:'100.00',tariffPercent:'10',tariffAmount:'10.01',currencyCode:'USD'}).finalUnitPrice,'110.01');
  assert.throws(()=>calculateOdmCustomerPrice({customerPrice:'100.00',tariffPercent:'10',tariffAmount:'10.02',currencyCode:'USD'}),/disagrees/);
  assert.throws(()=>calculateOdmCustomerPrice({customerPrice:'0.00',tariffAmount:'1.00',currencyCode:'USD'}),/Cannot infer/);
  assert.throws(()=>calculateOdmCustomerPrice({customerPrice:'10.001',currencyCode:'USD'}),/at most two decimal/);
});

test('manual form holds separate customer prices and omitted pricing remains unconfigured',()=>{
  const form=new FormData();
  for(const [id,price] of [[7,'10.00'],[8,'20.00'],[9,'']]){
    form.append('odmPriceAccountId',String(id));form.append('odmCustomerPrice',price);form.append('odmPreviousPrice','');form.append('odmCurrencyCode','USD');form.append('odmTariffPercent',price?'10':'');form.append('odmTariffAmount','');form.append('odmEffectiveDate','');form.append('odmPricingNotes','');
  }
  const rows=parseOdmPriceForm(form);
  assert.deepEqual(rows.map(row=>row.accountId),[7,8]);
  assert.deepEqual(rows.map(row=>calculateOdmCustomerPrice(row).finalUnitPrice),['11.00','22.00']);
});

test('Opportunity customer matching requires explicit choice for multiple Accounts and never matches outsiders',()=>{
  const item={catalogSource:'ODM',odmSubtype:'CUSTOMER_SPECIFIC',odmCustomers:[{accountId:7,name:'7-Eleven',prices:[{id:1,currencyCode:'USD',finalUnitPrice:'11.00'}]},{accountId:8,name:'NCR',prices:[{id:2,currencyCode:'USD',finalUnitPrice:'22.00'}]}]};
  assert.deepEqual(matchingOdmCustomers(item,[7],'USD').map(x=>x.price.finalUnitPrice),['11.00']);
  assert.equal(matchingOdmCustomers(item,[7,8],'USD').length,2);
  assert.equal(matchingOdmCustomers(item,[99],'USD').length,0);
  assert.equal(matchingOdmCustomers(item,[7],'EUR')[0].price,null);
});

test('Opportunity snapshot keeps old customer price and tariff after live terms change',()=>{
  const decimal=value=>new Prisma.Decimal(value);
  const old={id:1,accountId:7,customerPrice:decimal('100'),tariffPercent:decimal('10'),tariffAmount:decimal('10'),finalUnitPrice:decimal('110'),currencyCode:'USD',effectiveDate:new Date('2026-09-01')};
  const snapshot=odmCustomerSnapshot(old);
  const changed={...old,customerPrice:decimal('120'),tariffPercent:decimal('25'),tariffAmount:decimal('30'),finalUnitPrice:decimal('150')};
  assert.equal(odmCustomerSnapshot(changed,snapshot).odmCustomerFinalUnitPrice.toString(),'110');
  assert.equal(odmCustomerSnapshot({...changed,id:2},snapshot).odmCustomerFinalUnitPrice.toString(),'150');
});
