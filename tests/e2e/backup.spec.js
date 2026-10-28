import { readFileSync } from 'node:fs';
import { test, expect, openApp } from './fixtures.js';

test('backup → alles wissen → terugzetten brings everything back', async ({ page }) => {
  await openApp(page);
  await page.getByRole('link', { name: 'Instellingen' }).click();
  await expect(page.locator('#lastBackup')).toContainText('nog nooit');
  await page.getByRole('button', { name: 'minder' }).click();
  await page.getByLabel('Hoofdletters negeren').uncheck();

  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Backup maken' }).click()]);
  expect(download.suggestedFilename()).toMatch(/^deutsch-backup-\d{4}-\d\d-\d\d\.json$/);
  const file = await download.path();
  const backup = JSON.parse(readFileSync(file, 'utf8'));
  expect(backup.app).toBe('deutsch');
  await expect(page.getByText('Backup gemaakt ✓')).toBeVisible();
  await expect(page.locator('#lastBackup')).not.toContainText('nog nooit');

  // Reset asks twice.
  await page.getByRole('button', { name: 'Alles wissen' }).click();
  await page.getByRole('button', { name: 'Ja, wissen' }).click();
  await page.getByRole('button', { name: 'Definitief wissen' }).click();
  await page.getByRole('button', { name: 'Toch doorgaan in de browser' }).click();
  await page.getByRole('link', { name: 'Instellingen' }).click();
  await expect(page.locator('#newPerDay')).toHaveText('10');
  await expect(page.getByLabel('Hoofdletters negeren')).toBeChecked();

  // Cancelling the first question keeps everything.
  await page.getByRole('button', { name: 'Alles wissen' }).click();
  await page.getByRole('button', { name: 'Annuleren' }).click();
  await expect(page.getByRole('heading', { name: 'Instellingen' })).toBeVisible();

  await page.locator('#restoreFile').setInputFiles(file);
  await expect(page.getByRole('heading', { name: 'Backup terugzetten?' })).toBeVisible();
  await expect(page.getByText(/0 woorden, 0 kaarten, 0 herhalingen/)).toBeVisible();
  await page.getByRole('button', { name: 'Terugzetten', exact: true }).click();
  await expect(page.getByText('Backup teruggezet ✓')).toBeVisible();
  await page.getByRole('link', { name: 'Instellingen' }).click();
  await expect(page.locator('#newPerDay')).toHaveText('9');
  await expect(page.getByLabel('Hoofdletters negeren')).not.toBeChecked();
  await expect(page.locator('#lastBackup')).not.toContainText('nog nooit');
});

test('a file that is not a backup is refused with a message', async ({ page }) => {
  await openApp(page);
  await page.getByRole('link', { name: 'Instellingen' }).click();
  await page.locator('#restoreFile').setInputFiles({ name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{"hello":1}') });
  await expect(page.getByText('Dit is geen backup van deze app.')).toBeVisible();
});
