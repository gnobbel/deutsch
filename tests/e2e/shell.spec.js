import { test, expect, openApp, waitForSetting } from './fixtures.js';

test('first run explains installing, then the three tabs work', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Zet de app eerst op je beginscherm' })).toBeVisible();
  await expect(page.getByText('als je het icoon verwijdert, ben je al je voortgang kwijt')).toBeVisible();
  await expect(page.locator('#tabs')).toBeHidden();
  await page.getByRole('button', { name: 'Toch doorgaan in de browser' }).click();

  await expect(page.getByRole('heading', { name: 'Leren' })).toBeVisible();
  await page.screenshot({ path: 'test-results/screens/leren.png' });
  await page.getByRole('link', { name: 'Woorden' }).click();
  await expect(page.getByRole('heading', { name: 'Woorden' })).toBeVisible();
  await page.getByRole('link', { name: 'Instellingen' }).click();
  await expect(page.getByRole('heading', { name: 'Instellingen' })).toBeVisible();
  await page.screenshot({ path: 'test-results/screens/instellingen.png', fullPage: true });

  // The first-run screen does not come back.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Instellingen' })).toBeVisible();
});

test('the self-hosted font is used and has ä ö ü ß', async ({ page }) => {
  await openApp(page);
  const ok = await page.evaluate(async () => {
    await document.fonts.ready;
    return document.fonts.check('700 32px "Atkinson Hyperlegible"', 'äöüßÄÖÜ')
      && [...document.fonts].some((f) => f.family.includes('Atkinson') && f.status === 'loaded');
  });
  expect(ok).toBe(true);
  expect(await page.evaluate(() => getComputedStyle(document.body).fontFamily)).toContain('Atkinson Hyperlegible');
});

test('settings are saved and survive a reload', async ({ page }) => {
  await openApp(page);
  await page.getByRole('link', { name: 'Instellingen' }).click();
  await expect(page.locator('#newPerDay')).toHaveText('10');
  await page.getByRole('button', { name: 'meer' }).click();
  await page.getByRole('button', { name: 'meer' }).click();
  await page.locator('#retention').selectOption('0.85');
  await page.getByLabel('Hoofdletters negeren').uncheck();
  await waitForSetting(page, 'newPerDay', 12);
  await waitForSetting(page, 'retention', 0.85);
  await waitForSetting(page, 'ignoreCase', false);
  await page.reload();
  await expect(page.locator('#newPerDay')).toHaveText('12');
  await expect(page.locator('#retention')).toHaveValue('0.85');
  await expect(page.getByLabel('Hoofdletters negeren')).not.toBeChecked();
  await expect(page.getByLabel('ae, oe, ue, ss goed rekenen als ä, ö, ü, ß')).toBeChecked();
});

test('the manifest works under /deutsch/', async ({ page, request }) => {
  const res = await request.get('manifest.json');
  expect(res.ok()).toBe(true);
  const m = await res.json();
  expect(m.display).toBe('standalone');
  expect(m.start_url).toBe('./');
  for (const icon of m.icons) expect((await request.get(icon.src)).ok()).toBe(true);
  expect((await request.get('icons/apple-touch-icon.png')).ok()).toBe(true);
});
