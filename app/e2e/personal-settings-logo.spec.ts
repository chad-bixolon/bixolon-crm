import { PrismaClient } from '@prisma/client';
import { deflateSync } from 'node:zlib';
import { test, expect } from './fixtures';
import { signInAs } from './helpers';
import { databaseUrl, emails } from './constants.mjs';

const db = new PrismaClient({ datasourceUrl: databaseUrl });
test.afterAll(() => db.$disconnect());

function png(width: number, height: number, pixel: (x: number, y: number) => [number, number, number, number]) {
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const [r, g, b, a] = pixel(x, y);
    const offset = y * (1 + width * 4) + 1 + x * 4;
    raw.set([r, g, b, a], offset);
  }
  const crc = (bytes: Buffer) => {
    let value = 0xffffffff;
    for (const byte of bytes) {
      value ^= byte;
      for (let bit = 0; bit < 8; bit++) value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
    }
    return (value ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const name = Buffer.from(type);
    const size = Buffer.alloc(4);
    size.writeUInt32BE(data.length);
    const checksum = Buffer.alloc(4);
    checksum.writeUInt32BE(crc(Buffer.concat([name, data])));
    return Buffer.concat([size, name, data, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const marks = (x: number, y: number) => y >= 5 && y < 35 && (x >= 10 && x < 38 || x >= 48 && x < 72 || x >= 82 && x < 110);
const logos = [
  { name: 'transparent-white', width: 120, height: 40, color: [255, 255, 255, 255], file: png(120, 40, (x, y) => marks(x, y) ? [255, 255, 255, 255] : [0, 0, 0, 0]) },
  { name: 'transparent-dark-orange', width: 120, height: 40, color: [214, 82, 18, 255], file: png(120, 40, (x, y) => marks(x, y) ? x >= 48 && x < 72 ? [214, 82, 18, 255] : [31, 49, 71, 255] : [0, 0, 0, 0]) },
  { name: 'rectangular-company', width: 160, height: 60, color: [31, 49, 71, 255], file: png(160, 60, () => [31, 49, 71, 255]) },
] as const;

test('My Settings and all logo types fit five widths in Light and Dark', async ({ page }, testInfo) => {
  test.setTimeout(300_000);
  const user = await db.user.findUniqueOrThrow({ where: { email: emails.admin }, select: { id: true, appearancePreference: true } });
  const originalBranding = await db.deploymentBranding.findUnique({ where: { id: 1 } });
  test.skip(!!originalBranding?.logoStorageKey, 'The logo matrix uses the seeded default branding.');
  await signInAs(page, 'admin');
  try {
    for (const logo of [null, ...logos]) {
      if (logo) {
        const upload = await page.request.post('/api/branding/logo', { multipart: { file: { name: `${logo.name}.png`, mimeType: 'image/png', buffer: logo.file } } });
        expect(upload.ok(), `${logo.name}: ${await upload.text()}`).toBe(true);
      }
      for (const theme of ['LIGHT', 'DARK'] as const) {
        await db.user.update({ where: { id: user.id }, data: { appearancePreference: theme } });
        await page.goto('/my-integrations');
        await expect(page.getByRole('heading', { name: 'My Settings', exact: true })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Preferences', exact: true })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Integrations', exact: true })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Google Calendar', exact: true })).toBeVisible();
        await expect(page.getByLabel('Appearance', { exact: true })).toHaveValue(theme);
        await expect(page.getByText('Choose System to follow your device, or select Light or Dark to keep this appearance.')).toBeVisible();
        for (const width of [1440, 1024, 820, 768, 390]) {
          await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
          if (width < 1024) await page.getByRole('button', { name: 'Open menu' }).click();
          const image = page.locator('#primary-navigation-drawer img').first();
          await expect(image).toBeVisible();
          const metrics = await image.evaluate(img => {
            const element = img as HTMLImageElement;
            const box = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            const canvas = document.createElement('canvas');
            canvas.width = element.naturalWidth;
            canvas.height = element.naturalHeight;
            const context = canvas.getContext('2d')!;
            context.drawImage(element, 0, 0);
            return {
              width: box.width, height: box.height, right: box.right,
              naturalWidth: element.naturalWidth, naturalHeight: element.naturalHeight,
              objectFit: style.objectFit, filter: style.filter, background: style.backgroundColor,
              corner: [...context.getImageData(0, 0, 1, 1).data],
              center: [...context.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data],
            };
          });
          expect(metrics.objectFit, `${logo?.name ?? 'fallback'} ${theme} ${width}`).toBe('contain');
          expect(metrics.filter).toBe('none');
          expect(metrics.width).toBeLessThanOrEqual(176);
          expect(metrics.height).toBeLessThanOrEqual(40);
          expect(metrics.right).toBeLessThanOrEqual(width);
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
          if (logo) {
            expect(metrics.background).toBe('rgba(0, 0, 0, 0)');
            expect(metrics.naturalWidth).toBe(logo.width);
            expect(metrics.naturalHeight).toBe(logo.height);
            expect(metrics.center).toEqual([...logo.color]);
            if (logo.name.startsWith('transparent')) expect(metrics.corner[3]).toBe(0);
            expect(metrics.width / metrics.height).toBeCloseTo(logo.width / logo.height, 1);
          } else {
            expect(metrics.background).toBe('rgb(255, 255, 255)');
            expect(metrics.naturalWidth).toBe(500);
            expect(metrics.naturalHeight).toBe(40);
          }
          if (width === 390 || width === 1440) await page.screenshot({ path: testInfo.outputPath(`settings-${logo?.name ?? 'fallback'}-${theme.toLowerCase()}-${width}.png`), caret: 'initial' });
          if (width < 1024) await page.getByRole('button', { name: 'Close menu', exact: true }).click();
        }
      }
    }
  } finally {
    if (!originalBranding?.logoStorageKey) await page.request.delete('/api/branding/logo');
    await db.user.update({ where: { id: user.id }, data: { appearancePreference: user.appearancePreference } });
  }
});
