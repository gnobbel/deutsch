// A new version must show "Update beschikbaar", apply only on tap, and keep stored data.
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../../tools/serve.js';
import { test, expect, openApp, waitForServiceWorker, waitForSetting } from './fixtures.js';

const repo = fileURLToPath(new URL('../..', import.meta.url));
const SKIP = /(^|\/)(\.git|node_modules|test-results|playwright-report|tools|tests)(\/|$)/;
let dir, server, base;

// Each test gets its own copy of the app, as if freshly deployed.
test.beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'deutsch-update-'));
  cpSync(repo, dir, { recursive: true, filter: (src) => !SKIP.test(src.slice(repo.length)) });
  server = await startServer({ root: dir, port: 0, quiet: true });
  base = `http://localhost:${server.address().port}/deutsch/`;
});

test.afterEach(async () => {
  server?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

// Publishes a new version in the served copy, the way a push to main does.
function publish(version) {
  const swPath = join(dir, 'sw.js');
  const old = readFileSync(swPath, 'utf8').match(/const VERSION = '([^']+)'/)[1];
  writeFileSync(swPath, readFileSync(swPath, 'utf8').replace(`'${old}'`, `'${version}'`));
  writeFileSync(join(dir, 'strings.nl.js'), readFileSync(join(dir, 'strings.nl.js'), 'utf8').replace("title: 'Woorden'", "title: 'Woorden (nieuw)'"));
}

test('a new version applies on tap and keeps stored data', async ({ page }) => {
  const swPath = join(dir, 'sw.js');
  const oldVersion = readFileSync(swPath, 'utf8').match(/const VERSION = '([^']+)'/)[1];

  await openApp(page, base);
  await waitForServiceWorker(page);
  await page.getByRole('link', { name: 'Instellingen' }).click();
  await expect(page.locator('#version')).toHaveText(oldVersion);
  await page.getByRole('button', { name: 'meer' }).click();
  await expect(page.locator('#newPerDay')).toHaveText('11');
  await waitForSetting(page, 'newPerDay', 11);

  publish('99.0.0');
  await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
  await page.waitForFunction(async () => !!(await navigator.serviceWorker.getRegistration()).waiting);

  // Not on Home: nothing changes, nothing reloads.
  await page.waitForTimeout(300);
  await expect(page.locator('#version')).toHaveText(oldVersion);

  // On Home, the banner offers the update.
  await page.getByRole('link', { name: 'Leren' }).click();
  const banner = page.getByRole('button', { name: /Update beschikbaar/ });
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('99.0.0');
  await Promise.all([page.waitForEvent('load'), banner.click()]);

  await page.getByRole('link', { name: 'Instellingen' }).click();
  await expect(page.locator('#version')).toHaveText('99.0.0');
  await expect(page.locator('#newPerDay')).toHaveText('11');
  await page.getByRole('link', { name: 'Woorden' }).click();
  await expect(page.getByRole('heading', { name: 'Woorden (nieuw)' })).toBeVisible();
  expect(await page.evaluate(() => caches.keys())).toEqual(['deutsch-v99.0.0']);
});

test('a waiting update applies at the next cold start, without a tap', async ({ context }) => {
  let page = await context.newPage();
  await openApp(page, base);
  await waitForServiceWorker(page);
  await page.getByRole('link', { name: 'Instellingen' }).click();
  await page.getByRole('button', { name: 'meer' }).click();
  await waitForSetting(page, 'newPerDay', 11);

  publish('99.0.1');
  await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
  await page.waitForFunction(async () => !!(await navigator.serviceWorker.getRegistration()).waiting);

  // Close the app completely, then open it again. The browser activates the waiting version
  // once the last window is gone; on a phone, reopening the app takes longer than this pause.
  await page.close();
  await new Promise((r) => setTimeout(r, 1500));
  page = await context.newPage();
  await page.goto(base + '#instellingen');
  await expect(page.locator('#version')).toHaveText('99.0.1');
  await expect(page.locator('#newPerDay')).toHaveText('11');
  await page.getByRole('link', { name: 'Leren' }).click();
  await expect(page.getByRole('button', { name: /Update beschikbaar/ })).toHaveCount(0);
  expect(await page.evaluate(() => caches.keys())).toEqual(['deutsch-v99.0.1']);
});
