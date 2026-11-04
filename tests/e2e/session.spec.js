// A full first session, played the way the owner would: new words go through intro → multiple
// choice → two typing steps and graduate (PLAN §13 Stage 2 "Done when").
import { readFileSync } from 'node:fs';
import { test, expect, openApp, waitForSetting } from './fixtures.js';
import { displayForm } from '../../grading.js';
import { promptWord, spoken } from '../../cards.js';
import { WORD_FILES } from '../../session.js';

const words = WORD_FILES.flatMap((f) => JSON.parse(readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8')));
// The prompt side shows the Dutch word, and the Dutch sentence after "Toon zin"; together they
// identify the word.
const byPrompt = new Map(words.map((w) => [`${promptWord(w)}|${w.example.nl}`, w]));
// On the revealed side the German sentence (markers removed) identifies it (the validator keeps
// every sentence unique).
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
    // The sentence is hidden behind "Toon zin" (except on the intro card); tapping it shows it.
    const hidden = await page.locator('#showSentence').isVisible();
    if (hidden) await page.locator('#showSentence').click();
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
      expect(hidden, 'sentence hidden on the prompt').toBe(!w.contextSet);
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
      // "Toon zin" doesn't take the focus away from the answer field (the keyboard stays up).
      await expect(page.locator('#answer')).toBeFocused();
      const w = byPrompt.get(`${prompt}|${context}`);
      expect(w, `word for ${prompt}`).toBeTruthy();
      expect(hidden, 'sentence hidden on the prompt').toBe(!w.contextSet);
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
  await page.locator('#showSentence').click();
  const context = (await page.locator('.card .context').textContent()).trim();
  const w = byPrompt.get(`${prompt}|${context}`);
  await page.getByRole('button', { name: displayForm(w), exact: true }).click(); // spoken again → typing, same word
  await expect(page.locator('#answer')).toBeVisible();
  const said = await page.evaluate(() => window.__speech.map((x) => x.text));
  expect(said).toContain(spoken(w));
  const speaking = await page.evaluate(() => window.__speech.filter((x) => x.active).map((x) => x.text));
  expect(speaking).not.toContain(spoken(w));
});

// Identifies the word on a prompt card via "Toon zin".
async function promptedWord(page) {
  const prompt = (await page.locator('#word').textContent()).trim();
  if (await page.locator('#showSentence').isVisible()) await page.locator('#showSentence').click();
  const context = (await page.locator('.card .context').textContent()).trim();
  return byPrompt.get(`${prompt}|${context}`);
}

test('the sentence can be switched on for every card in Instellingen', async ({ page }) => {
  await openApp(page);
  await page.getByRole('link', { name: 'Instellingen' }).click();
  await page.getByLabel('Voorbeeldzin altijd tonen').check();
  await waitForSetting(page, 'showSentence', true);
  await page.getByRole('link', { name: 'Leren' }).click();
  await page.getByRole('button', { name: 'Start' }).click();
  await page.locator('#next').click(); // intro → multiple choice
  await expect(page.locator('.choices')).toBeVisible();
  await expect(page.locator('#showSentence')).toHaveCount(0);
  const prompt = (await page.locator('#word').textContent()).trim();
  const context = (await page.locator('.card .context').textContent()).trim();
  expect(byPrompt.get(`${prompt}|${context}`), 'the Dutch sentence is shown').toBeTruthy();
});

test('a level marked too easy: its words are scanned quickly instead of coming as new words', async ({ page }) => {
  const learnable = words.filter((w) => !w.clozeOnly);
  const inLevel = (n) => learnable.filter((w) => Math.ceil(w.rank / 100) === n);
  const [one, two] = [inLevel(1).length, inLevel(2).length];
  await openApp(page);
  await expect(page.locator('#level')).toHaveText(`Niveau 1 (A1) · 0 van ${one} woorden gehad`);
  await expect(page.locator('#scanBox')).toHaveCount(0);
  await page.locator('#levelEasy').click();
  await page.getByRole('button', { name: 'Ja, te makkelijk' }).click();
  await expect(page.locator('#level')).toHaveText(`Niveau 2 (A1) · 0 van ${two} woorden gehad`);
  await expect(page.locator('#scanBox')).toContainText('Snel doorlopen: 30 woorden vandaag');
  await expect(page.locator('#newLeft')).toContainText(`Nog ${learnable.length - one} nieuwe woorden in de app. Nog ${one} woorden om snel door te lopen.`);
  await page.screenshot({ path: 'test-results/screens/home-scan.png' });

  // The scan: ten words, German with the Dutch next to it. Tap the ones you don't know.
  await page.locator('#scan').click();
  await expect(page.locator('#tabs')).toBeHidden();
  const rows = page.locator('.scan-row');
  await expect(rows).toHaveCount(10);
  const ids = (await rows.evaluateAll((els) => els.map((e) => Number(e.dataset.id))));
  const byId = new Map(words.map((w) => [w.id, w]));
  expect(ids.every((id) => byId.get(id).rank <= 100)).toBe(true);
  await expect(rows.nth(0)).toContainText(displayForm(byId.get(ids[0])));
  await rows.nth(1).click();
  await rows.nth(3).click();
  await rows.nth(3).click(); // tapped twice: known after all
  await expect(rows.nth(1)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#scanCounts')).toHaveText('9 bekend · 1 niet');
  await page.screenshot({ path: 'test-results/screens/scan.png' });
  await page.locator('#scanNext').click();
  await expect(page.locator('#scanProgress')).toHaveText('10 van 30');
  const next = await rows.evaluateAll((els) => els.map((e) => Number(e.dataset.id)));
  expect(next.some((id) => ids.includes(id))).toBe(false);
  await page.getByRole('button', { name: 'Stoppen' }).click();

  // Stored: known → review (rated Easy), unknown → queued as the next new word.
  const db = await readIdb(page);
  const card = (id) => db.cards.find((c) => c.wordId === id);
  const ws = (id) => db.words.find((x) => x.wordId === id);
  expect(card(ids[0]).step).toBeNull();
  expect(card(ids[0]).fsrs.state).toBe(2);
  expect(ws(ids[0])).toMatchObject({ levelCheck: true, tooEasy: true });
  expect(card(ids[1])).toBeUndefined();
  expect(ws(ids[1])).toMatchObject({ scanMissed: true, queuedNext: true });
  expect(ws(ids[1]).introducedOn).toBeUndefined();

  await expect(page.locator('#scanBox')).toContainText('Snel doorlopen: 20 woorden vandaag');
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page.locator('.card .label')).toHaveText('Nieuw woord · niveau 1');
  await expect(page.locator('#word')).toContainText(byId.get(ids[1]).de);
  await page.getByRole('button', { name: 'Stoppen' }).click();

  // "Ik begin bij" in Instellingen → Niveaus marks every level below it.
  await page.getByRole('link', { name: 'Instellingen' }).click();
  await expect(page.locator('#startLevel')).toHaveValue('');
  await expect(page.locator('#level1')).toBeChecked();
  await page.locator('#startLevel').selectOption('A2');
  const a2 = learnable.filter((w) => w.level === 'A2').length;
  expect(a2).toBeGreaterThan(0);
  await expect(page.locator('#startLevel')).toHaveValue('A2');
  await expect(page.locator('#level2')).toBeChecked();
  await page.getByRole('link', { name: 'Leren' }).click();
  await expect(page.locator('#level')).toContainText('(A2)');
  await page.getByRole('link', { name: 'Instellingen' }).click();
  await page.locator('#startLevel').selectOption('A1');
  await expect(page.locator('#level1')).not.toBeChecked();
  await waitForSetting(page, 'easyLevels', []);
  await page.getByRole('link', { name: 'Leren' }).click();
  await expect(page.locator('#scanBox')).toHaveCount(0);
  // 9 known in the scan + the unknown one, started as a new word.
  await expect(page.locator('#level')).toContainText('Niveau 1 (A1) · 10 van');
});

test('five new words in a row known: the app offers to skip the rest of the level', async ({ page }) => {
  await openApp(page);
  await page.getByRole('button', { name: 'Start' }).click();
  for (let i = 0; i < 5; i++) {
    await expect(page.locator('#tooEasy')).toBeVisible();
    const w = byGerman.get((await page.locator('.card .context').textContent()).trim());
    await page.locator('#tooEasy').click();
    await page.locator('#answer').fill(displayForm(w));
    await page.locator('#answer').press('Enter');
    await expect(page.locator('.card .label')).toHaveText('Goed, dit woord zit erin');
    if (i < 4) {
      await expect(page.locator('#skipLevel')).toHaveCount(0);
      await page.locator('#answer').press('Enter');
    }
  }
  await expect(page.locator('#skipLevel')).toHaveText('Rest van niveau 1 overslaan');
  await page.screenshot({ path: 'test-results/screens/session-skip-level.png' });
  await page.locator('#skipLevel').click();
  await expect(page.locator('#skipLevelBox')).toContainText('Niveau 1 wordt overgeslagen');
  await waitForSetting(page, 'easyLevels', [1]);
  await page.locator('#answer').press('Enter');
  await expect(page.locator('.card .label')).toHaveText('Nieuw woord · niveau 2');
  await page.getByRole('button', { name: 'Stoppen' }).click();
  await expect(page.locator('#scanBox')).toBeVisible();
});

test('words with the same Dutch word where grammar decides: the sentence is the prompt', async ({ page }) => {
  // "naar" is zu (naar een persoon) or nach (naar een stad). zu is stored in its first typing step.
  await openApp(page);
  const zu = words.find((w) => w.de === 'zu' && w.contextSet === 'naar');
  await page.evaluate((id) => new Promise((resolve) => {
    const r = indexedDB.open('deutsch');
    r.onsuccess = () => {
      const tx = r.result.transaction(['cards', 'words'], 'readwrite');
      const now = new Date();
      tx.objectStore('words').put({ wordId: id, introducedOn: now, tooEasy: false, knownMarked: false, queuedNext: false, accepted: [] });
      tx.objectStore('cards').put({
        id: `${id}:production`, wordId: id, type: 'production', suspended: false, step: 'type1', leech: false,
        fsrs: { due: now, stability: 0, difficulty: 0, elapsed_days: 0, scheduled_days: 0, learning_steps: 0, reps: 0, lapses: 0, state: 0, last_review: null },
      });
      tx.oncomplete = () => { r.result.close(); resolve(); };
    };
  }), zu.id);
  await page.reload();
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page.locator('#word')).toHaveText('naar');
  // No "Toon zin", no hint, no first letter: the Dutch sentence is shown straight away.
  await expect(page.locator('#showSentence')).toHaveCount(0);
  await expect(page.locator('.card .context')).toHaveText(zu.example.nl);
  await expect(page.locator('.card .context b')).toHaveText('naar');
  await expect(page.locator('#hint')).toHaveCount(0);
  await expect(page.locator('#nlHint')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/screens/session-context-prompt.png' });
  // nach is a real mistake here, explained by the rule.
  await page.locator('#answer').fill('nach');
  await page.locator('#answer').press('Enter');
  await expect(page.locator('.card .label')).toHaveText('In deze zin past nach niet');
  await expect(page.locator('#rule')).toContainText('→ zu (zum Arzt, zur Schule)');
  await expect(page.locator('#override')).toHaveCount(0); // no "Ik had gelijk" for the other word of the set
  await expect(page.locator('#rule')).toContainText('naar een stad of land → nach');
  await page.screenshot({ path: 'test-results/screens/session-context-wrong.png' });
  await expect(page.locator('.card .context')).toHaveText(zu.example.de.replace(/\[\[|\]\]/g, ''));
  await page.locator('#answer').fill('zu');
  await page.locator('#answer').press('Enter');
  await expect(page.locator('.card .label')).not.toHaveText('In deze zin past nach niet'); // retyped: on to the next card
});

test('two words with the same Dutch prompt are told apart by a small hint', async ({ page }) => {
  // "waar" is the prompt of both wo (plaats) and wahr (juist). wahr is stored in its first typing
  // step, the way an unfinished word is, so the session starts with it.
  await openApp(page);
  const wahr = words.find((w) => w.de === 'wahr');
  await page.evaluate((id) => new Promise((resolve) => {
    const r = indexedDB.open('deutsch');
    r.onsuccess = () => {
      const tx = r.result.transaction(['cards', 'words'], 'readwrite');
      const now = new Date();
      tx.objectStore('words').put({ wordId: id, introducedOn: now, tooEasy: false, knownMarked: false, queuedNext: false, accepted: [] });
      tx.objectStore('cards').put({
        id: `${id}:production`, wordId: id, type: 'production', suspended: false, step: 'type1', leech: false,
        fsrs: { due: now, stability: 0, difficulty: 0, elapsed_days: 0, scheduled_days: 0, learning_steps: 0, reps: 0, lapses: 0, state: 0, last_review: null },
      });
      tx.oncomplete = () => { r.result.close(); resolve(); };
    };
  }), wahr.id);
  await page.reload();
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page.locator('#word')).toHaveText('waar');
  await expect(page.locator('#nlHint')).toHaveText('(juist)');
  await page.screenshot({ path: 'test-results/screens/session-hint.png' });
  await page.locator('#answer').fill('wahr');
  await page.locator('#answer').press('Enter');
  await expect(page.locator('#exampleNl')).toContainText('waar (juist)');
});
