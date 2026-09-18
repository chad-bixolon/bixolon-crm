// Live authenticated smoke check. Creates temporary catalog and Opportunity rows, then removes them.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
import { encode } from 'next-auth/jwt';
import { PrismaClient } from '@prisma/client';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
Module._extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText, filename);
const require = Module.createRequire(import.meta.url);
const { saveOpportunity, opportunityTotal } = require(path.join(appRoot, 'lib/opportunities.ts'));
const prisma = new PrismaClient();
const marker = `Picker smoke ${randomUUID()}`;
const part = `PICKER-${randomUUID()}`.toUpperCase();
let productId;
let opportunityId;
try {
  const [account, stage, currency, admin] = await Promise.all([
    prisma.account.findFirst({ where: { status: 'ACTIVE' }, select: { id: true } }),
    prisma.salesStage.findFirst({ where: { active: true }, select: { id: true } }),
    prisma.currency.findFirst({ where: { active: true }, select: { code: true } }),
    prisma.user.findFirst({ where: { role: 'ADMIN', active: true, archivedAt: null, identities: { some: {} } }, select: { id: true, identities: { select: { id: true }, take: 1 } } }),
  ]);
  assert.ok(account && stage && currency && admin, 'active account, stage, currency and linked admin are required');
  const product = await prisma.product.create({ data: {
    sku: part, name: marker, active: true,
    skus: { create: [
      { partNumber: `${part}-A`, normalizedPartNumber: `${part}-A`, description: 'Picker smoke description', active: true,
        prices: { create: [{ tier: 'STANDARD', currencyCode: currency.code, amount: '12.34' }] } },
      { partNumber: `${part}-B`, normalizedPartNumber: `${part}-B`, description: 'Second SKU', active: true },
    ] },
  }, include: { skus: { include: { prices: true } } } });
  productId = product.id;
  const sku = product.skus.find(item => item.partNumber.endsWith('-A'));
  const base = process.env.AUTH_URL ?? 'http://localhost:3000';
  const cookieName = base.startsWith('https:') ? '__Secure-authjs.session-token' : 'authjs.session-token';
  const token = await encode({ token: { crmUserId: admin.id, crmIdentityId: admin.identities[0].id }, secret: process.env.AUTH_SECRET, salt: cookieName, maxAge: 120 });
  const get = async (route) => {
    const response = await fetch(new URL(route, base), { headers: { Cookie: `${cookieName}=${token}` }, redirect: 'manual' });
    assert.equal(response.status, 200, `${route} returned HTTP ${response.status}`);
    return response;
  };
  for (const q of [marker.slice(0, 15), `${part}-A`, 'Picker smoke description']) {
    const data = await (await get(`/opportunities/product-search?q=${encodeURIComponent(q)}`)).json();
    assert.ok(data.products.length <= 25);
    assert.ok(data.products.some(item => item.id === productId), `search did not find Product for ${q}`);
  }
  const detail = (await (await get(`/opportunities/product-search?id=${productId}`)).json()).product;
  assert.equal(detail.skus.length, 2);
  const chosen = detail.skus.find(item => item.id === sku.id);
  assert.equal(chosen.prices.find(price => price.currencyCode === currency.code)?.amount, '12.34');
  const newPage = await (await get('/opportunities/new')).text();
  assert.match(newPage, /Opportunity products/);
  assert.match(newPage, /Add product/);
  const input = {
    name: marker, description: null, ownerId: null, projectId: null, stageId: stage.id,
    expectedCloseDate: null, probability: null, forecastCategory: null, currencyCode: currency.code,
    participants: [{ accountId: account.id, roles: ['END_USER'] }],
    lines: [{ productId, skuId: sku.id, quantity: 2, price: chosen.prices[0].amount }],
  };
  opportunityId = await saveOpportunity(prisma, input);
  let saved = await prisma.opportunity.findUniqueOrThrow({ where: { id: opportunityId }, include: { products: { include: { sku: true } } } });
  assert.equal(saved.products[0].sku?.partNumber, sku.partNumber);
  assert.equal(saved.products[0].quantity, 2);
  assert.equal(saved.products[0].estimatedUnitPrice.toFixed(2), '12.34');
  assert.equal(opportunityTotal(saved.products).toFixed(2), '24.68');
  const editPage = await (await get(`/opportunities/${opportunityId}/edit`)).text();
  assert.match(editPage, new RegExp(`name="productId" value="${productId}"`));
  assert.ok(editPage.includes(`name="skuId" value="${sku.id}"`), `edit page SKU input: ${editPage.match(/name="skuId"[^>]*>/)?.[0] ?? 'absent'}`);
  input.lines = [{ id: saved.products[0].id, productId, skuId: sku.id, quantity: 3, price: '15.00' }];
  await saveOpportunity(prisma, input, opportunityId);
  saved = await prisma.opportunity.findUniqueOrThrow({ where: { id: opportunityId }, include: { products: { include: { sku: true } } } });
  assert.equal(saved.products[0].skuId, sku.id);
  assert.equal(saved.products[0].quantity, 3);
  assert.equal(saved.products[0].estimatedUnitPrice.toFixed(2), '15.00');
  assert.equal(opportunityTotal(saved.products).toFixed(2), '45.00');
  const reopened = await (await get(`/opportunities/${opportunityId}`)).text();
  assert.ok(reopened.includes(sku.partNumber));
  const reopenedEdit = await (await get(`/opportunities/${opportunityId}/edit`)).text();
  assert.ok(reopenedEdit.includes(`name="skuId" value="${sku.id}"`), `reopened edit SKU input: ${reopenedEdit.match(/name="skuId"[^>]*>/)?.[0] ?? 'absent'}`);
  console.log('PASS: authenticated Product search by name, part number and description; 25-result cap; two-SKU detail and matching-currency STANDARD suggestion.');
  console.log('PASS: Opportunity create/edit, SKU persistence after reopen, quantity, estimated price and totals.');
} finally {
  if (opportunityId) await prisma.$transaction(async tx => {
    await tx.opportunityProduct.deleteMany({ where: { opportunityId } });
    await tx.opportunityAccountRole.deleteMany({ where: { opportunityId } });
    await tx.opportunityAccount.deleteMany({ where: { opportunityId } });
    await tx.opportunity.delete({ where: { id: opportunityId } });
  });
  if (productId) await prisma.$transaction(async tx => {
    const skuIds = (await tx.productSku.findMany({ where: { productId }, select: { id: true } })).map(item => item.id);
    await tx.productPrice.deleteMany({ where: { skuId: { in: skuIds } } });
    await tx.productSku.deleteMany({ where: { productId } });
    await tx.product.delete({ where: { id: productId } });
  });
  await prisma.$disconnect();
}
