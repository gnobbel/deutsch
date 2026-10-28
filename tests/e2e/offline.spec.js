import { readFileSync } from 'node:fs';
import { test, expect, openApp, waitForServiceWorker } from './fixtures.js';

const VERSION = readFileSync(new URL('../../sw.js', import.meta.url), 'utf8').match(/const VERSION = '([^']+)'/)[1];

test('works offline after the first load', async ({ page, context }) => {
  await openApp(page);
  await waitForServiceWorker(page);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Leren' })).toBeVisible();
  await page.getByRole('link', { name: 'Instellingen' }).click();
  await expect(page.locator('#version')).toHaveText(VERSION);
  // A cold start offline (new tab) works too.
  const second = await context.newPage();
  await second.goto('./#woorden');
  await expect(second.getByRole('heading', { name: 'Woorden' })).toBeVisible();
  await context.setOffline(false);
});
