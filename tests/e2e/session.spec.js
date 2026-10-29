// A full first session, played the way the owner would: new words go through intro → multiple
// choice → two typing steps and graduate (PLAN §13 Stage 2 "Done when").
import { readFileSync } from 'node:fs';
import { test, expect, openApp, waitForSetting } from './fixtures.js';
import { displayForm } from '../../grading.js';
import { promptWord, spoken } from '../../cards.js';
import { WORD_FILES } from '../../session.js';

const words = WORD_FILES.flatMap((f) => JSON.parse(readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8')));
// The prompt side shows the Dutch word and the Dutch sentence; together they identify the word.
const byPrompt = new Map(words.map((w) => [`${promptWord(w)}|${w.example.nl}`, w]));
// On the revealed side the German sentence (markers removed) identifies it.
const byGerman = new Map(words.map((w) => [w.example.de.replace(/\[\[|\]\]/g, ''), w]));

async function readIdb(page) {
  return page.evaluate(() => new Promise((resolve) => {
    const r = indexedDB.open('deutsch');
    r.onsuccess = () => {
      const tx = r.result.transaction(['cards', 'reviewLog', 'words']);
      const out = {};
      let n = 0;
      for (const s of ['cards', 'reviewLog', 'words']) {
        const g = tx.objectStore(s).getAll();
        g.onsuccess = () => { out[s] = g.result; if (++n === 3) { r.result.close(); resolve(out); } };
      }
    };
  }));
}

// Records what the app says, to check nothing is spoken over a prompt (§10.6).
async function recordSpeech(page) {
  await page.addInitScript(() => {
    window.__speech = [];
    const fake = {
      speak: (u) => window.__speech.push({ text: u.text, active: true }),
      cancel: () => window.__speech.forEach((x) => { x.active = false; }),
      getVoices: () => [],
      addEventListener: () => {},
    };
    Object.defineProperty(window, 'speechSynthesis', { value: fake, configurable: true });
  });
}

test('a first session: new words are introduced, practised and graduate', async ({ page }) => {
  test.setTimeout(90_000);
  await recordSpeech(page);
  await openApp(page);
  await expect(page.locator('#today')).toContainText('Nieuwe woorden vandaag: 10');
  await expect(page.locator('#newLeft')).toContainText('Nog');

  // Three new words a day for this test.
  await page.getByRole('link', { name: 'Instellingen' }).click();
  for (let i = 0; i < 7; i++) await page.getByRole('button', { name: 'minder' }).click();
  await waitForSetting(page, 'newPerDay', 3);
  await page.getByRole('link', { name: 'Leren' }).click();
  await expect(page.locator('#today')).toContainText('Nieuwe woorden vandaag: 3');
  await page.getByRole('button', { name: 'Start' }).click();

  const shots = new Set();
  const shot = async (name) => {
    if (shots.has(name)) return;
    shots.add(name);
    await page.screenshot({ path: `test-results/screens/session-${name}.png` });
  };
  let introduced = 0;
  let missedOnce = false;
  let steps = 0;
  for (; steps < 120; steps++) {
    if (await page.getByRole('heading', { name: 'Klaar voor vandaag' }).isVisible()) break;
    const revealed = await page.locator('.card.revealed').count();
    const context = (await page.locator('.card .context').textContent()).trim();
    const prompt = (await page.locator('#word').textContent()).trim();

    if (await page.locator('#tooEasy').isVisible()) {
      // Intro card: the German word is shown, with its gender color.
      introduced++;
      await shot('intro');
      if (introduced === 3) await page.locator('#tooEasy').click();
      else await page.locator('#next').click();
    } else if (await page.locator('.choices').isVisible()) {
      const w = byPrompt.get(`${prompt}|${context}`);
      expect(w, `word for ${prompt}`).toBeTruthy();
      await shot('choice');
      await page.getByRole('button', { name: displayForm(w), exact: true }).click();
    } else if (revealed) {
      const w = byGerman.get(context);
      expect(w, `word for ${context}`).toBeTruthy();
      if (await page.locator('.retype-label').isVisible()) {
        await shot('wrong');
        await page.locator('#answer').fill(displayForm(w));
      }
      await page.locator('#answer').press('Enter');
    } else {
      const w = byPrompt.get(`${prompt}|${context}`);
      expect(w, `word for ${prompt}`).toBeTruthy();
      // Nothing on the prompt side may hint at the answer (§1).
      await expect(page.locator('.card')).not.toContainText(w.de);
      await expect(page.locator('.card .art')).toHaveCount(0);
      const speaking = await page.evaluate(() => window.__speech.filter((x) => x.active).map((x) => x.text));
      expect(speaking, 'audio on the prompt side').not.toContain(spoken(w));
      await shot('typing');
      await page.locator('#answer').fill(!missedOnce && introduced >= 2 ? 'xyzzy' : displayForm(w));
      if (!missedOnce && introduced >= 2) missedOnce = true;
      await page.locator('#answer').press('Enter');
      await expect(page.locator('.card.revealed')).toBeVisible();
    }
  }
  await shot('done');
  await expect(page.locator('#doneStats')).toContainText('kaarten');
  expect(missedOnce).toBe(true);

  const db = await readIdb(page);
  // Te makkelijk doesn't count toward the limit, so a 4th word came in.
  expect(db.cards.length).toBe(4);
  for (const c of db.cards) {
    expect(c.step, c.id).toBeNull();
    expect(c.fsrs.state, c.id).toBe(2); // review
    expect(c.fsrs.reps, c.id).toBe(1); // rated exactly once
    const grades = db.reviewLog.filter((r) => r.cardId === c.id && r.grade != null).map((r) => r.grade);
    expect(grades.length, c.id).toBe(1);
  }
  expect(db.words.filter((w) => w.tooEasy).length).toBe(1);
  expect(db.reviewLog.every((r) => r.ts instanceof Date)).toBe(true);
  // The deliberate miss sent its word back through multiple choice.
  expect(db.reviewLog.some((r) => r.answer === 'xyzzy' && r.outcome === 'wrong')).toBe(true);

  await page.getByRole('button', { name: 'Terug' }).click();
  await expect(page.locator('#today')).toHaveText('Klaar voor vandaag ✓');
  await expect(page.locator('#start')).toBeDisabled();
  await expect(page.locator('#tabs')).toBeVisible();
});

test('the session can be left at any time; an unfinished word continues next time', async ({ page }) => {
  await openApp(page);
  await page.getByRole('button', { name: 'Start' }).click();
  await page.locator('#next').click(); // intro → multiple choice
  await expect(page.locator('.choices')).toBeVisible();
  await page.getByRole('button', { name: 'Stoppen' }).click();
  await expect(page.locator('#today')).toContainText('1 woord nog niet af');
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page.locator('.choices')).toBeVisible();
});

test('Home refreshes its numbers when the app comes back from the background', async ({ page }) => {
  await openApp(page);
  await expect(page.locator('#today')).toContainText('Nieuwe woorden vandaag: 10');
  await page.evaluate(() => new Promise((resolve) => {
    const r = indexedDB.open('deutsch');
    r.onsuccess = () => {
      const tx = r.result.transaction('settings', 'readwrite');
      tx.objectStore('settings').put({ key: 'newPerDay', value: 4 });
      tx.oncomplete = () => { r.result.close(); resolve(); };
    };
  }));
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.locator('#today')).toContainText('Nieuwe woorden vandaag: 4');
});

test('audio after an answer stops when the same word comes back as a prompt (§10.6)', async ({ page }) => {
  await recordSpeech(page);
  await openApp(page);
  await page.getByRole('link', { name: 'Instellingen' }).click();
  for (let i = 0; i < 9; i++) await page.getByRole('button', { name: 'minder' }).click();
  await waitForSetting(page, 'newPerDay', 1);
  await page.getByRole('link', { name: 'Leren' }).click();
  await page.getByRole('button', { name: 'Start' }).click();
  await page.locator('#next').click(); // intro (spoken) → multiple choice
  const prompt = (await page.locator('#word').textContent()).trim();
  const context = (await page.locator('.card .context').textContent()).trim();
  const w = byPrompt.get(`${prompt}|${context}`);
  await page.getByRole('button', { name: displayForm(w), exact: true }).click(); // spoken again → typing, same word
  await expect(page.locator('#answer')).toBeVisible();
  const said = await page.evaluate(() => window.__speech.map((x) => x.text));
  expect(said).toContain(spoken(w));
  const speaking = await page.evaluate(() => window.__speech.filter((x) => x.active).map((x) => x.text));
  expect(speaking).not.toContain(spoken(w));
});
