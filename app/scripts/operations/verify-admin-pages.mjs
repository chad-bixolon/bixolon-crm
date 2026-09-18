// Read-only authenticated smoke check using a short-lived in-memory test session.
import assert from 'node:assert/strict';
import { encode } from 'next-auth/jwt';
import { PrismaClient } from '@prisma/client';

const client = new PrismaClient();
try {
  const admin = await client.user.findFirst({
    where: { role: 'ADMIN', active: true, archivedAt: null, identities: { some: {} } },
    select: { id: true, identities: { select: { id: true }, take: 1 } },
  });
  assert.ok(admin, 'an active linked admin is required for the page smoke check');
  const base = process.env.AUTH_URL ?? 'http://localhost:3000';
  const cookieName = base.startsWith('https:') ? '__Secure-authjs.session-token' : 'authjs.session-token';
  const token = await encode({
    token: { crmUserId: admin.id, crmIdentityId: admin.identities[0].id },
    secret: process.env.AUTH_SECRET,
    salt: cookieName,
    maxAge: 60,
  });
  for (const [kind, label] of [['industries', 'Industry'], ['territories', 'Territory'], ['product-categories', 'Product Category']]) {
    const response = await fetch(new URL(`/administration/lookups/${kind}`, base), {
      headers: { Cookie: `${cookieName}=${token}` }, redirect: 'manual',
    });
    const body = await response.text();
    assert.equal(response.status, 200, `${kind} returned HTTP ${response.status}`);
    assert.ok(body.includes(`${label} values`), `${kind} title missing`);
    assert.ok(body.includes('name="code"') && body.includes('name="sortOrder"'), `${kind} form missing`);
    console.log(`PASS: ${kind} Administration page returned HTTP 200 with list and create form.`);
  }
  for (const route of ['/products', '/products?category=POS&catalogSource=PRICE_LIST', '/products?category=LABEL&catalogSource=PE_LIST']) {
    const response = await fetch(new URL(route, base), { headers: { Cookie: `${cookieName}=${token}` }, redirect: 'manual' });
    const body = await response.text();
    assert.equal(response.status, 200, `${route} returned HTTP ${response.status}`);
    assert.ok(body.includes('name="category"') && body.includes('name="catalogSource"'), `${route} lacks classification filters`);
    console.log(`PASS: ${route} returned HTTP 200 with Category and Catalog Source filters.`);
  }
  const [industry, territory, account] = await Promise.all([
    client.industry.findFirst({ where: { active: true }, select: { code: true } }),
    client.territory.findFirst({ where: { active: true }, select: { code: true } }),
    client.account.findFirst({ where: { status: { not: 'ARCHIVED' } }, select: { id: true } }),
  ]);
  assert.ok(industry && territory && account, 'active lookups and an editable Account are required');
  const htmlValue = (code) => code.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  for (const route of ['/accounts/new', `/accounts/${account.id}/edit`]) {
    const response = await fetch(new URL(route, base), {
      headers: { Cookie: `${cookieName}=${token}` }, redirect: 'manual',
    });
    const body = await response.text();
    assert.equal(response.status, 200, `${route} returned HTTP ${response.status}`);
    assert.ok(body.includes(`value="${htmlValue(industry.code)}"`), `${route} lacks active Industry`);
    assert.ok(body.includes(`value="${htmlValue(territory.code)}"`), `${route} lacks active Territory`);
    console.log(`PASS: ${route} returned HTTP 200 with active Industry and Territory options.`);
  }
} finally {
  await client.$disconnect();
}
