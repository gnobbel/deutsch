// Session flow: new-word selection, learning steps, lapses, interleaving (PLAN §6, §8.2).
process.env.TZ = 'Europe/Amsterdam';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { Session, WORD_FILES, pickNewWord, planToday, mcOptions, GAP } from '../../session.js';
import { Grade, State, newCard, rate, DEFAULT_SECONDS } from '../../srs.js';
import { displayForm } from '../../grading.js';
import { DEFAULT_SETTINGS } from '../../db.js';

const NOW = new Date('2026-10-29T10:00:00+01:00');
const W = (id, de, nl, o = {}) => ({ id, rank: id, level: 'A1', pos: 'adj', de, nl: [nl], acceptAlso: [], groups: [], showInitial: false, ...o });
const base = [
  W(1, 'gut', 'goed'), W(2, 'klein', 'klein'), W(3, 'groß', 'groot'), W(4, 'neu', 'nieuw'), W(5, 'alt', 'oud'),
  W(6, 'Montag', 'maandag', { pos: 'noun', article: 'der', plural: 'Montage', groups: ['weekdays'] }),
  W(7, 'Dienstag', 'dinsdag', { pos: 'noun', article: 'der', plural: 'Dienstage', groups: ['weekdays'] }),
  W(8, 'doch', 'toch', { pos: 'particle', clozeOnly: true }),
  W(9, 'schnell', 'snel'), W(10, 'langsam', 'langzaam'), W(11, 'warm', 'warm'), W(12, 'kalt', 'koud'),
];
for (let i = 13; i <= 60; i++) base.push(W(i, `wort${i}`, `woord${i}`));

function memoryStore() {
  const s = { cards: new Map(), words: new Map(), log: [], reports: [] };
  return Object.assign(s, {
    putCard: async (c) => { s.cards.set(c.id, structuredClone(c)); },
    putWord: async (w) => { s.words.set(w.wordId, structuredClone(w)); },
    addLog: async (r) => { s.log.push({ ...r }); return s.log.length - 1; },
    updateLog: async (k, r) => { s.log[k] = { ...r }; },
    addReport: async (r) => { s.reports.push(r); },
  });
}

function session({ words = base, cards = [], wordStates = [], settings = {}, now = NOW } = {}) {
  const store = memoryStore();
  let t = now.getTime();
  const s = new Session({
    words, cards, wordStates, store, settings: { ...DEFAULT_SETTINGS, ...settings }, seconds: DEFAULT_SECONDS,
    now: () => new Date((t += 1000)), random: () => 0.5,
  });
  return { s, store };
}

// Plays a session the way a perfect learner would; `answer` can override per screen.
async function play(s, answer = () => null, max = 500) {
  const seen = [];
  for (let i = 0; i < max; i++) {
    const sc = s.next();
    if (!sc) {
      await s.flush();
      return seen;
    }
    seen.push({ id: sc.word.id, step: sc.step, n: s.shown });
    const custom = answer(sc);
    if (sc.step === 'intro') s.answerIntro(sc, custom ?? 'continue', 3000);
    else if (sc.step === 'mc') s.answerChoice(sc, custom ?? sc.correct, 2000);
    else s.answerTyped(sc, custom ?? displayForm(sc.word), 4000);
  }
  throw new Error('session did not end');
}

const reviewCard = (wordId, reviewedDaysAgo) => {
  const t = new Date(NOW.getTime() - reviewedDaysAgo * 864e5);
  return { ...rate(newCard(wordId, 'production', t), Grade.Good, t), step: null };
};

test('WORD_FILES lists every file in words/', () => {
  assert.deepEqual(WORD_FILES, readdirSync('words').sort().map((f) => `words/${f}`));
});

test('new words come in rank order, skip clozeOnly, and "leer dit als volgende" goes first', () => {
  const ws = new Map([[7, { wordId: 7, queuedNext: true }]]);
  assert.equal(pickNewWord(base, ws, new Map(), NOW).id, 7);
  const done = new Map([1, 2, 3, 4, 5, 6, 7].map((id) => [id, { wordId: id, introducedOn: new Date('2026-10-01') }]));
  assert.equal(pickNewWord(base, done, new Map(), NOW).id, 9, 'doch (clozeOnly) is skipped');
});

test('confusable-set rule: one weekday per day, and not while another is still in learning', () => {
  const ws = new Map([1, 2, 3, 4, 5].map((id) => [id, { wordId: id, introducedOn: new Date('2026-10-01') }]));
  ws.set(6, { wordId: 6, introducedOn: NOW });
  assert.equal(pickNewWord(base, ws, new Map(), NOW).id, 9, 'Dienstag waits; it keeps its place');
  ws.set(6, { wordId: 6, introducedOn: new Date('2026-10-20') });
  assert.equal(pickNewWord(base, ws, new Map(), NOW).id, 7, 'next day, Dienstag is next');
  const learning = new Map([['6:production', { ...newCard(6, 'production', NOW), step: 'type2' }]]);
  assert.equal(pickNewWord(base, ws, learning, NOW).id, 9, 'Montag still in learning');
});

test('daily limit: words introduced today count, Te makkelijk ones do not', () => {
  const ws = new Map([
    [1, { wordId: 1, introducedOn: NOW, tooEasy: false }],
    [2, { wordId: 2, introducedOn: NOW, tooEasy: true }],
    [3, { wordId: 3, introducedOn: new Date('2026-10-01'), tooEasy: false }],
  ]);
  const plan = planToday({ words: base, wordStates: ws, cards: new Map(), settings: { ...DEFAULT_SETTINGS, newPerDay: 10 }, seconds: DEFAULT_SECONDS, now: NOW });
  assert.equal(plan.newToday, 9);
  assert.equal(plan.newLeft, base.length - 3 - 1);
});

test('a new word: intro → multiple choice → two typing steps → graduates with one Good', async () => {
  const { s, store } = session({ settings: { newPerDay: 1 } });
  const seen = await play(s);
  assert.deepEqual(seen.map((x) => x.step), ['intro', 'mc', 'type1', 'type2']);
  const card = store.cards.get('1:production');
  assert.equal(card.step, null);
  assert.equal(card.fsrs.state, State.Review);
  assert.equal(card.fsrs.reps, 1, 'FSRS rated exactly once');
  assert.deepEqual(store.log.map((r) => r.grade), [null, null, null, Grade.Good]);
  assert.equal(store.words.get(1).introducedOn instanceof Date, true);
});

test('learning steps are spread out: typing 1 after 3+ other cards, typing 2 after 8+', async () => {
  const cards = Array.from({ length: 30 }, (_, i) => reviewCard(30 + i, 3)).filter((c) => c.fsrs.due <= new Date(NOW.getTime() + 864e5));
  const { s } = session({ cards: cards.length ? cards : Array.from({ length: 30 }, (_, i) => reviewCard(30 + i, 10)), settings: { newPerDay: 3 } });
  const seen = await play(s);
  for (const id of [1, 2, 3]) {
    const at = (step) => seen.find((x) => x.id === id && x.step === step).n;
    assert.ok(at('type1') - at('mc') - 1 >= GAP.type1, `word ${id} type1`);
    assert.ok(at('type2') - at('type1') - 1 >= GAP.type2, `word ${id} type2`);
  }
});

test('one new word after about every 4 reviews', async () => {
  const cards = Array.from({ length: 12 }, (_, i) => reviewCard(30 + i, 10));
  const { s } = session({ cards, settings: { newPerDay: 2 } });
  const seen = await play(s);
  assert.deepEqual(seen.slice(0, 5).map((x) => x.step), ['review', 'review', 'review', 'review', 'intro']);
});

test('multiple-choice miss: intro again, multiple choice later; typing miss: multiple choice, then the same step', async () => {
  const { s, store } = session({ settings: { newPerDay: 1 } });
  let mcMissed = false;
  let typeMissed = false;
  const seen = await play(s, (sc) => {
    if (sc.step === 'mc' && !mcMissed) { mcMissed = true; return (sc.correct + 1) % 4; }
    if (sc.step === 'type2' && !typeMissed) { typeMissed = true; return 'falsch'; }
    return null;
  });
  assert.deepEqual(seen.map((x) => x.step), ['intro', 'mc', 'mc', 'type1', 'type2', 'mc', 'type2']);
  assert.equal(store.cards.get('1:production').fsrs.reps, 1);
});

test('Te makkelijk: one correct answer → Easy, not counted, so another new word follows', async () => {
  const { s, store } = session({ settings: { newPerDay: 1 } });
  const seen = await play(s, (sc) => (sc.step === 'intro' && sc.word.id === 1 ? 'tooEasy' : null));
  assert.deepEqual(seen.slice(0, 2).map((x) => x.step), ['intro', 'tooEasy']);
  assert.equal(store.words.get(1).tooEasy, true);
  assert.equal(store.log.find((r) => r.step === 'tooEasy').grade, Grade.Easy);
  assert.ok(seen.some((x) => x.id === 2 && x.step === 'type2'), 'word 2 introduced and learned');
});

test('Te makkelijk answered wrong → the normal learning steps', async () => {
  const { s, store } = session({ settings: { newPerDay: 1 } });
  const seen = await play(s, (sc) => (sc.step === 'intro' ? 'tooEasy' : sc.step === 'tooEasy' ? 'slecht' : null));
  assert.deepEqual(seen.map((x) => x.step), ['intro', 'tooEasy', 'mc', 'type1', 'type2']);
  assert.equal(store.words.get(1).tooEasy, false);
});

test('lapse: rated Again once, then one relearning step that is not rated', async () => {
  const { s, store } = session({ cards: [reviewCard(1, 10)], settings: { newPerDay: 0 } });
  let first = true;
  const seen = await play(s, (sc) => (sc.step === 'review' && first ? ((first = false), 'falsch') : null));
  assert.deepEqual(seen.map((x) => x.step), ['review', 'relearn']);
  assert.deepEqual(store.log.map((r) => r.grade), [Grade.Again, null]);
  const card = store.cards.get('1:production');
  assert.equal(card.step, null);
  assert.equal(card.fsrs.lapses, 1);
});

test('almost on a review is Hard; a different valid word gets no grade and shows the first letter', async () => {
  const words = base.map((w) => (w.id === 3 ? { ...w, de: 'großartig', acceptAlso: ['toll'] } : w));
  const { s, store } = session({ words, cards: [reviewCard(3, 10)], settings: { newPerDay: 0 } });
  const sc = s.next();
  const r1 = s.answerTyped(sc, 'toll', 1000);
  assert.equal(r1.outcome, 'different');
  assert.equal((s.next()).hint, 'g');
  const r2 = s.answerTyped(sc, 'grossartgi', 1000);
  assert.equal(r2.outcome, 'almost');
  await s.flush();
  assert.deepEqual(store.log.map((r) => r.grade), [null, Grade.Hard]);
});

test('an unfinished word continues at the start of the next session', async () => {
  const card = { ...newCard(2, 'production', new Date('2026-10-28T10:00:00+01:00')), step: 'type2' };
  const ws = { wordId: 2, introducedOn: new Date('2026-10-28T10:00:00+01:00'), tooEasy: false, accepted: [] };
  const { s } = session({ cards: [card], wordStates: [ws], settings: { newPerDay: 1 } });
  const first = s.next();
  assert.deepEqual([first.word.id, first.step], [2, 'type2']);
});

test('"Ik had gelijk" on a lapse: graded Good instead, answer accepted from then on, reported', async () => {
  const { s, store } = session({ cards: [reviewCard(1, 10)], settings: { newPerDay: 0 } });
  const sc = s.next();
  const r = s.answerTyped(sc, 'prima', 1000);
  assert.equal(r.outcome, 'wrong');
  assert.equal(r.canOverride, true);
  s.override();
  await s.flush();
  const card = store.cards.get('1:production');
  assert.equal(card.fsrs.lapses, 0);
  assert.equal(card.step, null);
  assert.deepEqual(store.words.get(1)?.accepted ?? [], ['prima']);
  assert.equal(store.reports[0].kind, 'override');
  assert.equal(store.log[0].grade, Grade.Good);
  assert.equal(s.next(), null, 'no relearning step after the override');
});

test('"Ik had gelijk" is refused when grading did not offer it', async () => {
  const words = base.map((w) => (w.id === 3 ? { ...w, de: 'schön', nl: ['mooi'] } : w));
  const { s } = session({ words, cards: [reviewCard(3, 10)], settings: { newPerDay: 0 } });
  s.answerTyped(s.next(), 'schon', 1000);
  assert.equal(s.override(), null);
});

test('multiple choice: 4 options, nouns with articles, one the same noun with a wrong article', () => {
  const words = JSON.parse(readFileSync(WORD_FILES[0], 'utf8'));
  let i = 0;
  const random = () => ((i = (i * 9301 + 49297) % 233280) / 233280);
  for (const w of words.filter((x) => !x.clozeOnly)) {
    const { options, correct } = mcOptions(w, words, random);
    assert.equal(new Set(options).size, 4, w.de);
    assert.equal(options[correct], displayForm(w), w.de);
    const others = options.filter((_, k) => k !== correct);
    for (const o of others) assert.ok(!(w.acceptAlso || []).includes(o), `${w.de}: ${o} is a valid answer`);
    if (w.pos === 'noun') {
      assert.ok(options.every((o) => /^(der|die|das) /.test(o)), w.de);
      assert.ok(others.some((o) => o.endsWith(` ${w.de}`)), w.de);
    }
  }
});
