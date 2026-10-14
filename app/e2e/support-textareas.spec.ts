import { test, expect } from './fixtures';
import { signInAs as standardSignInAs, uniqueName } from './helpers';

for (const [width, height] of [[1440, 900], [768, 1024], [390, 844]]) {
  test(`Support notes expand with typing and paste, cap height, and retain full saved content at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height });
    await standardSignInAs(page, 'support');
    await page.goto('/support/cases/new');
    const description = page.getByLabel('Description', { exact: true });
    expect((await description.boundingBox())!.height).toBeLessThan(280);
    await page.getByLabel('Customer / End User').fill('Textarea regression customer');
    await page.getByRole('combobox', { name: 'Linked CRM Account (optional)' }).fill('E2E Picker Account');
    await page.getByRole('option', { name: /^E2E Picker Account Philadelphia, PA$/ }).click();
    await page.getByLabel('Subject', { exact: true }).fill(uniqueName('Textarea regression case'));
    await page.getByRole('combobox', { name: 'Source', exact: true }).selectOption('PHONE');
    await description.fill('Synthetic case for note textarea validation.');
    await page.getByRole('button', { name: 'Create case', exact: true }).click();
    await expect(page).toHaveURL(/\/support\/cases\/\d+$/);
    const caseUrl = page.url();
    const caseId = new URL(caseUrl).pathname.split('/').at(-1)!;
    await page.goto(`/notes/new?supportCaseId=${caseId}`);
    const note = page.getByLabel('Note', { exact: true });
    await expect(note).toHaveAttribute('rows', '5');
    await expect(note).toHaveAttribute('required', '');
    await expect(note).toHaveAttribute('maxlength', '10000');
    const initialHeight = (await note.boundingBox())!.height;
    expect(initialHeight).toBeGreaterThanOrEqual(118);
    expect(initialHeight).toBeLessThanOrEqual(140);
    await note.focus();
    expect(await note.evaluate(el => getComputedStyle(el).outlineStyle)).not.toBe('none');
    await page.screenshot({ path: testInfo.outputPath(`note-initial-${width}.png`), fullPage: true, caret: 'initial' });
    await page.getByRole('button', { name: 'Create note', exact: true }).click();
    expect(await note.evaluate(el => (el as HTMLTextAreaElement).validity.valueMissing)).toBe(true);
    await note.pressSequentially('Troubleshooting steps:\n1. Checked power\n2. Checked cables\n3. Restarted printer\n4. Printed test page\n5. Checked driver\n6. Retested connection');
    expect((await note.boundingBox())!.height).toBeGreaterThan(initialHeight + 10);
    // Native resize handle stays usable, and subsequent short edits retain it.
    await note.scrollIntoViewIfNeeded();
    const box = (await note.boundingBox())!;
    await page.mouse.move(box.x + box.width - 4, box.y + box.height - 4);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 4, box.y + box.height + 56, { steps: 8 });
    await page.mouse.up();
    const manualHeight = (await note.boundingBox())!.height;
    expect(manualHeight).toBeGreaterThan(box.height + 30);
    await note.press('End');
    await note.pressSequentially('.');
    expect((await note.boundingBox())!.height).toBeGreaterThanOrEqual(manualHeight - 1);
    const longNote = Array.from({ length: 100 }, (_, index) => `Step ${index + 1}: Complete support note text retained.`).join('\n');
    await note.selectText();
    // insertText exercises multiline paste input without clipboard permissions.
    await page.keyboard.insertText(longNote);
    await expect(note).toHaveValue(longNote);
    const dimensions = await note.evaluate(el => ({ height: el.getBoundingClientRect().height, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, resize: getComputedStyle(el).resize, overflow: getComputedStyle(el).overflowY }));
    expect(dimensions.height).toBeCloseTo(Math.min(height / 2, 480), 0);
    expect(dimensions.scrollHeight).toBeGreaterThan(dimensions.clientHeight);
    expect(dimensions.resize).toBe('vertical');
    expect(dimensions.overflow).toBe('auto');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`note-expanded-${width}.png`), fullPage: true, caret: 'initial' });
    await expect(page.locator('input[name="supportCaseId"]')).toHaveValue(caseId);
    await page.getByRole('button', { name: 'Create note', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/support/cases/${caseId}`));
    await page.getByRole('button', { name: 'Show timeline', exact: true }).click();
    const savedNote = page.getByRole('region', { name: 'Case Timeline' }).getByRole('listitem').filter({ has: page.getByRole('heading', { name: 'Note added', exact: true }) });
    await expect(savedNote).toContainText('Step 1: Complete support note text retained.');

  });
}
