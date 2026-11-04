// Sessions played the way the owner would: Leren in rounds (multiple choice, then typed, then
// gekend), Herhalen, Toets, levels (PLAN §6, §9).
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

// Identifies the word on a prompt card via "Toon zin".
async function promptedWord(page) {
  const prompt = (await page.locator('#word').textContent()).trim();
  if (await page.locator('#showSentence').isVisible()) await page.locator('#showSentence').click();
  const context = (await page.locator('.card .context').textContent()).trim();
  return byPrompt.get(`${prompt}|${context}`);
}

// Writes settings straight into IndexedDB (then reload).
async function putSettings(page, values) {
  await page.evaluate((v) => new Promise((resolve) => {
    const r = indexedDB.open('deutsch');
    r.onsuccess = () => {
      const tx = r.result.transaction('settings', 'readwrite');
      for (const [key, value] of Object.entries(v)) tx.objectStore('settings').put({ key, value });
      tx.oncomplete = () => { r.result.close(); resolve(); };
    };
  }), values);
}

// Stores words as being learned at a given step, the way an unfinished word is.
async function putLearning(page, ids, step) {
  await page.evaluate(([list, st]) => new Promise((resolve) => {
    const r = indexedDB.open('deutsch');
    r.onsuccess = () => {
      const tx = r.result.transaction(['cards', 'words'], 'readwrite');
      const now = new Date();
      for (const id of list) {
        tx.objectStore('words').put({ wordId: id, introducedOn: now, tooEasy: false, knownMarked: false, queuedNext: false, accepted: [] });
        tx.objectStore('cards').put({
          id: `${id}:production`, wordId: id, type: 'production', suspended: false, step: st, leech: false,
          fsrs: { due: now, stability: 0, difficulty: 0, elapsed_days: 0, scheduled_days: 0, learning_steps: 0, reps: 0, lapses: 0, state: 0, last_review: null },
        });
      }
      tx.oncomplete = () => { r.result.close(); resolve(); };
    };
  }), [ids, step]);
}

test('a first Leren session: rounds of multiple choice, then typed, then gekend', async ({ page }) => {
  test.setTimeout(90_000);
  await recordSpeech(page);
  await openApp(page);
  await expect(page.locator('#reviewBlock')).toContainText('Niets te herhalen');
  await expect(page.locator('#newToday')).toHaveText('Vandaag nog 10 nieuwe woorden.');
  await expect(page.locator('#level')).toContainText('Niveau 1 (A1)');
  await expect(page.locator('#startTest')).toBeDisabled();
  await expect(page.locator('#newLeft')).toContainText('Nog');

  // Three new words a day for this test.
  await page.getByRole('link', { name: 'Instellingen' }).click();
  for (let i = 0; i < 7; i++) await page.getByRole('button', { name: 'minder' }).click();
  await waitForSetting(page, 'newPerDay', 3);
  await page.getByRole('link', { name: 'Leren' }).click();
  await expect(page.locator('#newToday')).toHaveText('Vandaag nog 3 nieuwe woorden.');
  await page.screenshot({ path: 'test-results/screens/home.png' });
  await page.locator('#startLearn').click();

  const shots = new Set();
  const shot = async (name) => {
    if (shots.has(name)) return;
    shots.add(name);
    await page.screenshot({ path: `test-results/screens/session-${name}.png` });
  };
  let firstQuestions = 0;
  let mcMissed = false;
  let typedMissed = false;
  let rounds = 0;
  for (let steps = 0; steps < 80; steps++) {
    if (await page.getByRole('heading', { name: 'Klaar voor vandaag' }).isVisible()) break;
    if (await page.locator('#nextRound').isVisible()) {
      rounds++;
      await shot('round');
      await expect(page.locator('#roundResults li').first()).toBeVisible();
      await expect(page.locator('#roundBar')).toBeVisible();
      await page.locator('#nextRound').click();
      continue;
    }
    const revealed = await page.locator('.card.revealed').count();
    if (await page.locator('.choices').isVisible()) {
      const hidden = await page.locator('#showSentence').isVisible();
      const w = await promptedWord(page);
      expect(w, 'word on the multiple choice').toBeTruthy();
      expect(hidden, 'sentence hidden on the prompt').toBe(!w.contextSet);
      // Nothing on the prompt side may hint at the answer (§1), apart from the options themselves.
      await expect(page.locator('.card')).not.toContainText(w.de);
      await expect(page.locator('.card .art')).toHaveCount(0);
      const isFirst = await page.locator('#tooEasy').isVisible();
      if (isFirst) firstQuestions++;
      await shot(isFirst ? 'first-question' : 'choice');
      if (isFirst && firstQuestions === 3) {
        await page.locator('#tooEasy').click(); // "Ken ik al": typed next round
        await expect(page.locator('#toast')).toHaveText('Volgende ronde vragen we je het woord te typen.');
      } else if (isFirst && firstQuestions === 2 && !mcMissed) {
        mcMissed = true;
        await page.locator('#dontKnow').click();
        await expect(page.locator('.card .label')).toHaveText('Dit is het woord');
        await expect(page.locator('#toast')).toBeHidden(); // no "Goed ✓" left from the card before
        await expect(page.locator('.card.revealed')).toBeVisible();
        await shot('shown-word');
        await page.locator('#next').click();
      } else {
        await page.getByRole('button', { name: displayForm(w), exact: true }).click();
      }
    } else if (revealed) {
      if (await page.locator('.retype-label').isVisible()) {
        await shot('wrong');
        const w = byGerman.get((await page.locator('.card .context').textContent()).trim());
        await page.locator('#answer').fill(displayForm(w));
      }
      await page.locator('#answer').press('Enter');
    } else {
      // A typed question. "Toon zin" doesn't take the focus away (the keyboard stays up).
      await expect(page.locator('#answer')).toBeFocused();
      const w = await promptedWord(page);
      expect(w, 'word on the typed question').toBeTruthy();
      await expect(page.locator('.card')).not.toContainText(w.de);
      await expect(page.locator('.card .art')).toHaveCount(0);
      const speaking = await page.evaluate(() => window.__speech.filter((x) => x.active).map((x) => x.text));
      expect(speaking, 'audio on the prompt side').not.toContain(spoken(w));
      await shot('typing');
      const miss = !typedMissed && !(await page.locator('.card .label').textContent()).includes('Ken je dit al');
      await page.locator('#answer').fill(miss ? 'xyzzy' : displayForm(w));
      if (miss) typedMissed = true;
      await page.locator('#answer').press('Enter');
      await expect(page.locator('.card.revealed')).toBeVisible();
    }
  }
  await shot('done');
  await expect(page.locator('#doneStats')).toContainText('kaarten');
  expect(mcMissed && typedMissed).toBe(true);
  expect(rounds).toBeGreaterThanOrEqual(3);

  const db = await readIdb(page);
  // Ken ik al doesn't count toward the limit, so a 4th word came in.
  expect(db.cards.length).toBe(4);
  for (const c of db.cards) {
    expect(c.step, c.id).toBeNull();
    expect(c.fsrs.state, c.id).toBe(2); // review
    expect(c.fsrs.reps, c.id).toBe(1); // rated exactly once
    const grades = db.reviewLog.filter((r) => r.cardId === c.id && r.grade != null).map((r) => r.grade);
    expect(grades.length, c.id).toBe(1);
  }
  const grades = db.reviewLog.filter((r) => r.grade != null).map((r) => r.grade).sort();
  expect(grades, 'one Hard (the typed miss), one Easy (Ken ik al), the rest Good').toEqual([2, 3, 3, 4]);
  expect(db.words.filter((w) => w.tooEasy).length).toBe(1);
  expect(db.reviewLog.every((r) => r.ts instanceof Date)).toBe(true);
  expect(db.reviewLog.some((r) => r.answer === 'xyzzy' && r.outcome === 'wrong')).toBe(true);
  expect(db.reviewLog.some((r) => r.outcome === 'dontKnow')).toBe(true);

  await page.locator('#back').click();
  await expect(page.locator('#levelProgress')).toContainText('4 gekend · 0 bezig');
  await expect(page.locator('#startTest')).toBeEnabled();
});

test('Toets: the learned words of the level, typed, with a score at the end', async ({ page }) => {
  await openApp(page);
  // Four words of level 1 learned yesterday (in review).
  const ids = words.filter((w) => !w.clozeOnly && w.rank <= 100).slice(0, 4).map((w) => w.id);
  await page.evaluate((list) => new Promise((resolve) => {
    const r = indexedDB.open('deutsch');
    r.onsuccess = () => {
      const tx = r.result.transaction(['cards', 'words'], 'readwrite');
      const y = new Date(Date.now() - 864e5);
      const due = new Date(Date.now() + 2 * 864e5);
      for (const id of list) {
        tx.objectStore('words').put({ wordId: id, introducedOn: y, tooEasy: false, knownMarked: false, queuedNext: false, accepted: [] });
        tx.objectStore('cards').put({
          id: `${id}:production`, wordId: id, type: 'production', suspended: false, step: null, leech: false,
          fsrs: { due, stability: 3, difficulty: 2, elapsed_days: 0, scheduled_days: 3, learning_steps: 0, reps: 1, lapses: 0, state: 2, last_review: y },
        });
      }
      tx.oncomplete = () => { r.result.close(); resolve(); };
    };
  }), ids);
  await page.reload();
  await expect(page.locator('#levelProgress')).toContainText('4 gekend');
  await page.locator('#startTest').click();
  let wrong = null;
  for (let i = 0; i < 4; i++) {
    await expect(page.locator('#where')).toHaveText(`Toets · ${i + 1} van 4`);
    const w = await promptedWord(page);
    expect(ids).toContain(w.id);
    if (i === 1) wrong = w;
    await page.locator('#answer').fill(i === 1 ? 'xyzzy' : displayForm(w));
    await page.locator('#answer').press('Enter');
    await expect(page.locator('.card.revealed')).toBeVisible();
    if (i === 1) await page.locator('#answer').fill(displayForm(w));
    await page.locator('#answer').press('Enter');
  }
  await expect(page.getByRole('heading', { name: 'Toets klaar' })).toBeVisible();
  await expect(page.locator('#doneStats')).toHaveText('3 van 4 goed');
  await expect(page.locator('#testMissed')).toContainText(displayForm(wrong));
  await page.screenshot({ path: 'test-results/screens/test-done.png' });
  const db = await readIdb(page);
  expect(db.cards.find((c) => c.wordId === wrong.id).fsrs.lapses).toBe(1);
  expect(db.reviewLog.filter((r) => r.step === 'test' && r.grade != null).length).toBe(4);
});

test('choosing a level: new words come from it, and Home shows its progress', async ({ page }) => {
  await openApp(page);
  await page.locator('#chooseLevel').click();
  await expect(page.locator('#tabs')).toBeHidden();
  await expect(page.locator('#levelAuto')).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({ path: 'test-results/screens/levels.png' });
  await page.locator('#pick3').click();
  await waitForSetting(page, 'learnLevel', 3);
  await expect(page.locator('#level')).toContainText('Niveau 3');
  await expect(page.locator('#level')).not.toContainText('automatisch');
  await page.locator('#startLearn').click();
  await expect(page.locator('.card .label')).toHaveText('Nieuw woord · niveau 3');
  const w = await promptedWord(page);
  expect(Math.ceil(w.rank / 100)).toBe(3);
  await page.getByRole('button', { name: displayForm(w), exact: true }).click();
  await page.getByRole('button', { name: 'Stoppen' }).click();
  await expect(page.locator('#levelProgress')).toContainText('0 gekend · 1 bezig');
  // Back to the normal order.
  await page.locator('#chooseLevel').click();
  await page.locator('#levelAuto').click();
  await waitForSetting(page, 'learnLevel', null);
  await expect(page.locator('#level')).toContainText('automatisch');
});

test('the "Goed ✓" of a multiple choice never sits on top of the next answer\'s feedback', async ({ page }) => {
  // The toast's timer is made very long, as if the answer came within its 1.2 s: only the reveal
  // may hide it. A fixed random order puts a typed question right after a multiple choice.
  await page.addInitScript(() => {
    const later = window.setTimeout;
    window.setTimeout = (fn, ms, ...args) => later(fn, ms >= 1000 && ms <= 3000 ? 600000 : ms, ...args);
    let seed = 7;
    Math.random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  });
  await openApp(page);
  const ids = words.filter((w) => !w.clozeOnly && !w.contextSet && w.rank <= 100).slice(0, 7).map((w) => w.id);
  await putLearning(page, ids.slice(0, 3), 'mc');
  await putLearning(page, ids.slice(3), 'type1');
  await putSettings(page, { newPerDay: 0 });
  await page.reload();
  await page.locator('#startLearn').click();
  let checked = false;
  let previousWasChoice = false;
  for (let steps = 0; steps < 20 && !checked; steps++) {
    if (await page.locator('.choices').isVisible()) {
      const w = await promptedWord(page);
      await page.getByRole('button', { name: displayForm(w), exact: true }).click();
      previousWasChoice = true;
      continue;
    }
    if (previousWasChoice) {
      await expect(page.locator('#toast')).toBeVisible(); // still up from the multiple choice
      await page.locator('#answer').fill('xyzzy');
      await page.locator('#answer').press('Enter');
      await expect(page.locator('.card.revealed')).toBeVisible();
      await expect(page.locator('#toast')).toBeHidden();
      checked = true;
      break;
    }
    const w = await promptedWord(page);
    await page.locator('#answer').fill(displayForm(w));
    await page.locator('#answer').press('Enter');
    await page.locator('#answer').press('Enter');
  }
  expect(checked, 'a typed question came right after a multiple choice').toBe(true);
});

test('Leren can be left at any time; an unfinished word continues next time', async ({ page }) => {
  await openApp(page);
  await page.locator('#startLearn').click();
  const w = await promptedWord(page);
  await page.getByRole('button', { name: displayForm(w), exact: true }).click();
  await page.getByRole('button', { name: 'Stoppen' }).click();
  await expect(page.locator('#learnBlock')).toContainText('1 woord nog niet af');
  await expect(page.locator('#newToday')).toHaveText('Vandaag nog 9 nieuwe woorden.');
  await page.locator('#startLearn').click();
  await expect(page.locator('#where')).toHaveText('Ronde 1');
});

test('Home refreshes its numbers when the app comes back from the background', async ({ page }) => {
  await openApp(page);
  await expect(page.locator('#newToday')).toHaveText('Vandaag nog 10 nieuwe woorden.');
  await putSettings(page, { newPerDay: 4 });
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.locator('#newToday')).toHaveText('Vandaag nog 4 nieuwe woorden.');
});

test('audio after an answer stops when the same word comes back as a prompt (§10.6)', async ({ page }) => {
  await recordSpeech(page);
  await openApp(page);
  await putSettings(page, { newPerDay: 1 });
  await page.reload();
  await page.locator('#startLearn').click();
  const w = await promptedWord(page);
  const said0 = await page.evaluate(() => window.__speech.map((x) => x.text));
  expect(said0, 'nothing spoken on the first question').not.toContain(spoken(w));
  await page.getByRole('button', { name: displayForm(w), exact: true }).click(); // spoken
  await page.locator('#nextRound').click(); // round 2: the same word, typed
  await expect(page.locator('#answer')).toBeVisible();
  const said = await page.evaluate(() => window.__speech.map((x) => x.text));
  expect(said).toContain(spoken(w));
  const speaking = await page.evaluate(() => window.__speech.filter((x) => x.active).map((x) => x.text));
  expect(speaking).not.toContain(spoken(w));
});

test('the sentence can be switched on for every card in Instellingen', async ({ page }) => {
  await openApp(page);
  await page.getByRole('link', { name: 'Instellingen' }).click();
  await page.getByLabel('Voorbeeldzin altijd tonen').check();
  await waitForSetting(page, 'showSentence', true);
  await page.getByRole('link', { name: 'Leren' }).click();
  await page.locator('#startLearn').click();
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
  await putSettings(page, { newPerDay: 1 });
  await page.reload();
  await expect(page.locator('#level')).toContainText('Niveau 1 (A1)');
  await expect(page.locator('#levelProgress')).toHaveText(`0 gekend · 0 bezig · ${one} nieuw`);
  await expect(page.locator('#scanBox')).toHaveCount(0);
  await page.locator('#levelEasy').click();
  await page.getByRole('button', { name: 'Ja, te makkelijk' }).click();
  await expect(page.locator('#level')).toContainText('Niveau 2 (A1)');
  await expect(page.locator('#levelProgress')).toHaveText(`0 gekend · 0 bezig · ${two} nieuw`);
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

  // The unknown word is the next new word (one a day here, so it is the round's only word).
  await expect(page.locator('#scanBox')).toContainText('Snel doorlopen: 20 woorden vandaag');
  await page.locator('#startLearn').click();
  await expect(page.locator('.card .label')).toHaveText('Nieuw woord · niveau 1');
  expect((await promptedWord(page)).id).toBe(ids[1]);
  await page.getByRole('button', { name: displayForm(byId.get(ids[1])), exact: true }).click();
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
  await expect(page.locator('#levelProgress')).toHaveText(`9 gekend · 1 bezig · ${one - 10} nieuw`);
});

test('five new words in a row known: the app offers to skip the rest of the level', async ({ page }) => {
  await openApp(page);
  await page.locator('#startLearn').click();
  // Round 1: "Ken ik al" on every word. Round 2: each is typed; after the fifth right answer the
  // app offers to skip the level.
  let known = 0;
  while (await page.locator('#tooEasy').isVisible()) {
    await page.locator('#tooEasy').click();
    known++;
  }
  expect(known).toBe(7);
  await page.locator('#nextRound').click();
  let passed = 0;
  for (let steps = 0; steps < 10 && passed < 5; steps++) {
    await expect(page.locator('.card .label')).toHaveText('Ken je dit al? Typ het Duitse woord.');
    const w = await promptedWord(page);
    expect(w).toBeTruthy();
    await page.locator('#answer').fill(displayForm(w));
    await page.locator('#answer').press('Enter');
    await expect(page.locator('.card .label')).toHaveText('Goed, dit woord zit erin');
    passed++;
    if (passed < 5) {
      await expect(page.locator('#skipLevel')).toHaveCount(0);
      await page.locator('#answer').press('Enter');
    }
  }
  expect(passed).toBe(5);
  await expect(page.locator('#skipLevel')).toHaveText('Rest van niveau 1 overslaan');
  await page.screenshot({ path: 'test-results/screens/session-skip-level.png' });
  await page.locator('#skipLevel').click();
  await expect(page.locator('#skipLevelBox')).toContainText('Niveau 1 wordt overgeslagen');
  await waitForSetting(page, 'easyLevels', [1]);
  await page.locator('#answer').press('Enter');
  // The two checks left in this round; then the next new words are from level 2.
  for (let steps = 0; steps < 4 && !(await page.locator('#nextRound').isVisible()); steps++) {
    const w = await promptedWord(page);
    await page.locator('#answer').fill(displayForm(w));
    await page.locator('#answer').press('Enter');
    await expect(page.locator('.card.revealed')).toBeVisible();
    await page.locator('#answer').press('Enter');
  }
  await page.locator('#nextRound').click();
  await expect(page.locator('.card .label')).toHaveText('Nieuw woord · niveau 2');
  await page.getByRole('button', { name: 'Stoppen' }).click();
  await expect(page.locator('#scanBox')).toBeVisible();
});

test('words with the same Dutch word where grammar decides: the sentence is the prompt', async ({ page }) => {
  // "naar" is zu (naar een persoon) or nach (naar een stad). zu is stored in its typed step.
  await openApp(page);
  const zu = words.find((w) => w.de === 'zu' && w.contextSet === 'naar');
  await putLearning(page, [zu.id], 'type1');
  await putSettings(page, { newPerDay: 0 });
  await page.reload();
  await page.locator('#startLearn').click();
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
  await expect(page.locator('#nextRound')).toBeVisible(); // retyped: on to the round summary
});

test('two words with the same Dutch prompt are told apart by a small hint', async ({ page }) => {
  // "waar" is the prompt of both wo (plaats) and wahr (juist). wahr is stored in its typed step.
  await openApp(page);
  const wahr = words.find((w) => w.de === 'wahr');
  await putLearning(page, [wahr.id], 'type1');
  await putSettings(page, { newPerDay: 0 });
  await page.reload();
  await page.locator('#startLearn').click();
  await expect(page.locator('#word')).toHaveText('waar');
  await expect(page.locator('#nlHint')).toHaveText('(juist)');
  await page.screenshot({ path: 'test-results/screens/session-hint.png' });
  await page.locator('#answer').fill('wahr');
  await page.locator('#answer').press('Enter');
  await expect(page.locator('#exampleNl')).toContainText('waar (juist)');
});

test('Herhalen: due reviews, a lapse comes back once more, then done', async ({ page }) => {
  await openApp(page);
  const ids = words.filter((w) => !w.clozeOnly && !w.contextSet && w.rank <= 100).slice(0, 3).map((w) => w.id);
  await page.evaluate((list) => new Promise((resolve) => {
    const r = indexedDB.open('deutsch');
    r.onsuccess = () => {
      const tx = r.result.transaction(['cards', 'words'], 'readwrite');
      const before = new Date(Date.now() - 5 * 864e5);
      for (const id of list) {
        tx.objectStore('words').put({ wordId: id, introducedOn: before, tooEasy: false, knownMarked: false, queuedNext: false, accepted: [] });
        tx.objectStore('cards').put({
          id: `${id}:production`, wordId: id, type: 'production', suspended: false, step: null, leech: false,
          fsrs: { due: new Date(Date.now() - 864e5), stability: 3, difficulty: 2, elapsed_days: 0, scheduled_days: 3, learning_steps: 0, reps: 1, lapses: 0, state: 2, last_review: before },
        });
      }
      tx.oncomplete = () => { r.result.close(); resolve(); };
    };
  }), ids);
  await page.reload();
  await expect(page.locator('#today')).toContainText('3 herhalingen');
  await expect(page.locator('#startReview')).toHaveClass(/primary/);
  await page.locator('#startReview').click();
  let answered = 0;
  for (let steps = 0; steps < 12; steps++) {
    if (await page.getByRole('heading', { name: 'Klaar met herhalen' }).isVisible()) break;
    const w = await promptedWord(page);
    expect(ids).toContain(w.id);
    const miss = answered === 0;
    await page.locator('#answer').fill(miss ? 'xyzzy' : displayForm(w));
    await page.locator('#answer').press('Enter');
    if (miss) await page.locator('#answer').fill(displayForm(w));
    await page.locator('#answer').press('Enter');
    answered++;
  }
  expect(answered).toBe(4); // 3 reviews + 1 relearning step
  await page.locator('#back').click();
  await expect(page.locator('#reviewBlock')).toContainText('Niets te herhalen');
});
