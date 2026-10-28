// Shared e2e helpers. Every test fails on console errors or uncaught exceptions.
import { test as base, expect } from '@playwright/test';

export const test = base.extend({
  page: async ({ page }, use) => {
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(e.message));
    await use(page);
    expect(errors, 'console errors').toEqual([]);
  },
});
export { expect };

// Opens the app and gets past the first-run screen the way the owner would in a browser.
export async function openApp(page, url = './') {
  await page.goto(url);
  await page.getByRole('button', { name: 'Toch doorgaan in de browser' }).click();
  await expect(page.getByRole('heading', { name: 'Leren' })).toBeVisible();
}

// Waits until the service worker controls the page, so later loads come from its cache.
export async function waitForServiceWorker(page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise((r) => navigator.serviceWorker.addEventListener('controllerchange', r, { once: true }));
    }
  });
}
