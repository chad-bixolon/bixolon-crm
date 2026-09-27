import test from 'node:test';
import assert from 'node:assert/strict';
import { missingSpecialConfigurationPrices } from '../lib/odm-missing-price-audit.mjs';

test('read-only audit finds imported resolved Special Configuration prices without an active price',()=>{
  const row={sourceKey:'immutable',workbook:'Gary.xlsx',sheet:'ODM',rowNumber:5,partIndex:1,disposition:'IMPORTED',source:{newPrice:'120.00',tariffPercent:'13.5%'},resolution:{partNumber:'ODM-1',accountId:7,subtype:'SPECIAL_CONFIGURATION',price:'120.00',tariffPercent:'13.5',tariffAmount:'16.20'}};
  const sku={id:20,partNumber:'ODM-1',normalizedPartNumber:'ODM-1',catalogSource:'ODM',odmSubtype:'SPECIAL_CONFIGURATION',odmCustomers:[{accountId:7,archivedAt:null,prices:[]}]};
  const rows=missingSpecialConfigurationPrices([row],[sku],[{id:7,name:'UPS'}]);
  assert.deepEqual(rows,[{sku:'ODM-1',skuId:20,account:'UPS',accountId:7,sourcePrice:'120.00',tariffPercent:'13.5',tariffAmount:'16.20',workbook:'Gary.xlsx',sheet:'ODM',rowNumber:5,partIndex:1,sourceKey:'immutable'}]);
  assert.deepEqual(missingSpecialConfigurationPrices([row],[{...sku,odmCustomers:[{accountId:7,archivedAt:null,prices:[{archivedAt:null}]}]}],[{id:7,name:'UPS'}]),[]);
  assert.deepEqual(missingSpecialConfigurationPrices([{...row,resolution:{...row.resolution,price:'-'}}],[sku],[{id:7,name:'UPS'}]),[]);
  assert.equal(missingSpecialConfigurationPrices([{...row,resolution:{...row.resolution,accountId:null},source:{...row.source,customerCell:'UPS'}}],[sku],[{id:7,name:'UPS'}]).length,1);
  assert.equal(row.source.newPrice,'120.00');
});
