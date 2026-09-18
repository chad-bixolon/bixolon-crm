// Exercise Product Category administration, filtering, and list-source previews in one rolled-back transaction.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { PrismaClient } from '@prisma/client';

Module._extensions['.ts'] = (mod, filename) => {
  const source = fs.readFileSync(filename, 'utf8');
  mod._compile(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, filename);
};
const load = (name) => Module.createRequire(import.meta.url)(path.resolve('lib', name));
const { saveLookup, listLookups } = load('lookups.ts');
const { listProducts, productCategoryChoices } = load('products.ts');
const { planProductImport } = load('product-import.ts');
const client = new PrismaClient();
const code = `VERIFY_PRODUCT_${Date.now().toString(36)}`;
const rollback = new Error('verification rollback');
let productId, skuId;

try {
  await client.$transaction(async (tx) => {
    const product = await tx.product.findFirst({ where: { archivedAt: null, skus: { some: {} } }, include: { skus: { take: 1 } } });
    assert.ok(product, 'a Product with a SKU is required');
    productId = product.id;
    skuId = product.skus[0].id;
    assert.equal(product.categoryId, null);
    assert.equal(product.skus[0].catalogSource, null);

    await saveLookup(tx, 'product-categories', { code, name: code, active: true, sortOrder: 9 }, false);
    const category = await tx.productCategory.findUniqueOrThrow({ where: { code } });
    assert.ok((await listLookups(tx, 'product-categories')).some(value => value.code === code));
    await saveLookup(tx, 'product-categories', { code, name: `${code}_edited`, active: true, sortOrder: 2 }, true);
    assert.deepEqual((await tx.productCategory.findUniqueOrThrow({ where: { code } })).name, `${code}_edited`);
    assert.equal((await tx.productCategory.findUniqueOrThrow({ where: { code } })).sortOrder, 2);

    await tx.product.update({ where: { id: productId }, data: { categoryId: category.id } });
    const status = product.active ? 'active' : 'inactive';
    for (const source of ['PRICE_LIST', 'PE_LIST', 'SPECIAL_SKU_LIST']) {
      await tx.productSku.update({ where: { id: skuId }, data: { catalogSource: source } });
      const result = await listProducts(tx, { category: code, catalogSource: source, q: product.sku, active: status });
      assert.ok(result.products.some(value => value.id === productId), `${source} filter missed the linked Product`);
    }

    for (const source of ['PE_LIST', 'SPECIAL_SKU_LIST']) {
      const csv = `model,part_number,category,catalog_source\n${code},${code}_${source},${code},${source}\n`;
      const plan = await planProductImport(tx, csv, source);
      assert.equal(plan.counts.errors, 0);
      assert.equal(plan.items[0].after.category, code);
      assert.equal(plan.items[0].after.catalogSource, source);
    }

    await saveLookup(tx, 'product-categories', { code, name: `${code}_edited`, active: false, sortOrder: 2 }, true);
    assert.ok((await productCategoryChoices(tx)).some(value => value.code === code && !value.active));
    const inactive = await planProductImport(tx, `model,part_number,category\n${code},${code}_INACTIVE,${code}\n`);
    assert.equal(inactive.counts.errors, 1);
    await saveLookup(tx, 'product-categories', { code, name: `${code}_edited`, active: true, sortOrder: 3 }, true);
    assert.ok((await productCategoryChoices(tx)).some(value => value.code === code && value.active && value.sortOrder === 3));
    throw rollback;
  }, { timeout: 30000 });
  throw new Error('verification transaction unexpectedly committed');
} catch (error) {
  if (error !== rollback) throw error;
} finally {
  assert.equal(await client.productCategory.findUnique({ where: { code } }), null);
  if (productId) assert.equal((await client.product.findUniqueOrThrow({ where: { id: productId } })).categoryId, null);
  if (skuId) assert.equal((await client.productSku.findUniqueOrThrow({ where: { id: skuId } })).catalogSource, null);
  await client.$disconnect();
}
console.log('PASS: Product Category create/edit/reorder/deactivate/reactivate, three source filters, and PE/Special previews; transaction rolled back.');
