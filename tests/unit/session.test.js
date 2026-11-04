// Session flow: new-word selection, learning steps, lapses, interleaving (PLAN §6, §8.2).
process.env.TZ = 'Europe/Amsterdam';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import {
  Session, WORD_FILES, pickNewWord, planToday, mcOptions, ROUND_SIZE, TEST_SIZE, levelProgress, testCards, levelReach, chosenLevel, levels, currentLevel, levelOf, SCANS_PER_DAY, LEVEL_SIZE,
  scanBatch, applyScan, levelLooksEasy, levelsBelow, startLevelOf,
  difficultyOf, difficultyBand, HARD_PER_DAY,
} from '../../session.js';
import { Grade, State, newCard, rate, DEFAULT_SECONDS } from '../../srs.js';
import { displayForm } from '../../grading.js';
import { DEFAULT_SETTINGS } from '../../db.js';

const NOW = new Date('2026-10-29T10:00:00+01:00');
const W = (id, de, nl, o = {}) => ({ id, rank: id, level: 'A1', pos: 'adj', de, nl: [nl], acceptAlso: [], groups: [], showInitial: false, cognate: true, falseFriend: null, ...o });
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

function session({ words = base, cards = [], wordStates = [], settings = {}, now = NOW, mode = 'review', level = null } = {}) {
  const store = memoryStore();
  let t = now.getTime();
  const s = new Session({
    words, cards, wordStates, store, settings: { ...DEFAULT_SETTINGS, ...settings }, seconds: DEFAULT_SECONDS, mode, level,
    now: () => new Date((t += 1000)), random: () => 0.5,
  });
  return { s, store };
}

// Plays a session the way a perfect learner would; `answer` can override per screen ('tooEasy'
// on a new word's first question is "Ken ik al"). Round summaries show up as { step: 'round' }.
async function play(s, answer = () => null, max = 500) {
  const seen = [];
  for (let i = 0; i < max; i++) {
    const sc = s.next();
    if (!sc) {
      await s.flush();
      return seen;
    }
    if (sc.step === 'round') {
      seen.push({ step: 'round', n: s.shown, results: sc.results });
      s.nextRound();
      continue;
    }
    seen.push({ id: sc.word.id, step: sc.step, n: s.shown });
    const custom = answer(sc);
    if (sc.step === 'intro' && custom === 'tooEasy') s.answerIntro(sc, 'tooEasy', 3000);
    else if (sc.step === 'intro' || sc.step === 'mc') s.answerChoice(sc, custom ?? sc.correct, 2000);
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

test('Leren: a new word starts as multiple choice, is typed next round, then gekend with one Good', async () => {
  const { s, store } = session({ mode: 'learn', settings: { newPerDay: 1 } });
  const seen = await play(s);
  assert.deepEqual(seen.map((x) => x.step), ['intro', 'round', 'type1', 'round']);
  const card = store.cards.get('1:production');
  assert.equal(card.step, null);
  assert.equal(card.fsrs.state, State.Review);
  assert.equal(card.fsrs.reps, 1, 'FSRS rated exactly once');
  assert.deepEqual(store.log.map((r) => r.grade), [null, Grade.Good]);
  assert.equal(store.words.get(1).introducedOn instanceof Date, true);
  assert.deepEqual(seen[1].results.map((r) => r.ok), [true]);
});

test('Leren: rounds of up to ROUND_SIZE words, each once per round, never the same word twice in a row', async () => {
  const { s } = session({ mode: 'learn', settings: { newPerDay: 10 } });
  const seen = await play(s);
  const rounds = [];
  let cur = [];
  for (const x of seen) {
    if (x.step === 'round') { rounds.push(cur); cur = []; } else cur.push(x.id);
  }
  assert.equal(rounds[0].length, ROUND_SIZE, 'the first round is full');
  for (const r of rounds) assert.equal(new Set(r).size, r.length, 'each word once per round');
  const flat = seen.filter((x) => x.step !== 'round');
  for (let i = 1; i < flat.length; i++) assert.notEqual(flat[i].id, flat[i - 1].id, 'never twice in a row');
  // Round 2 asks the same 7 typed; once they are gekend, the 8th to 10th words fill round 3.
  assert.deepEqual(new Set(rounds[1]), new Set(rounds[0]));
  assert.equal(new Set(flat.map((x) => x.id)).size, 10);
  assert.ok(rounds[2].length === 3 && rounds[2].every((id) => !rounds[0].includes(id)));
});

test('Herhalen has only reviews and relearning steps; Leren only words being learned', async () => {
  const cards = Array.from({ length: 5 }, (_, i) => reviewCard(30 + i, 10));
  const review = await play(session({ cards, settings: { newPerDay: 3 } }).s);
  assert.ok(review.every((x) => x.step === 'review'));
  assert.equal(review.length, 5);
  const learn = await play(session({ cards, mode: 'learn', settings: { newPerDay: 3 } }).s);
  assert.ok(learn.every((x) => x.step !== 'review'));
  assert.equal(learn.filter((x) => x.step === 'intro').length, 3);
});

test('a wrong multiple choice: the word is shown, multiple choice again next round; a typed miss: multiple choice, then typed again', async () => {
  const { s, store } = session({ mode: 'learn', settings: { newPerDay: 1 } });
  let mcMissed = false;
  let typeMissed = false;
  const seen = await play(s, (sc) => {
    if (sc.step === 'intro' && !mcMissed) { mcMissed = true; return (sc.correct + 1) % 4; }
    if (sc.step === 'type1' && !typeMissed) { typeMissed = true; return 'falsch'; }
    return null;
  });
  assert.deepEqual(seen.filter((x) => x.step !== 'round').map((x) => x.step), ['intro', 'mc', 'type1', 'mc', 'type1']);
  assert.equal(store.cards.get('1:production').fsrs.reps, 1);
  assert.equal(store.log.find((r) => r.step === 'intro').outcome, 'wrong');
});

test('"Weet ik niet" on the first question counts as a first look, like a wrong choice', async () => {
  const { s, store } = session({ mode: 'learn', settings: { newPerDay: 1 } });
  const sc = s.next();
  const r = s.answerChoice(sc, -1, 1000);
  assert.deepEqual([r.correct, r.showWord], [false, true]);
  await play(s);
  assert.equal(store.log[0].outcome, 'dontKnow');
  assert.equal(store.log.find((x) => x.grade != null).grade, Grade.Good, 'a first look is not a miss');
});

test('Te makkelijk ("Ken ik al"): one correct typed answer at the end of the next round → Easy, not counted, so another new word follows', async () => {
  const { s, store } = session({ mode: 'learn', settings: { newPerDay: 4 } });
  const seen = await play(s, (sc) => (sc.step === 'intro' && sc.word.id === 1 ? 'tooEasy' : null));
  const round2 = seen.slice(seen.findIndex((x) => x.step === 'round') + 1);
  assert.equal(round2[round2.findIndex((x) => x.step === 'round') - 1].step, 'tooEasy', 'the check ends round 2');
  assert.equal(store.words.get(1).tooEasy, true);
  assert.equal(store.log.find((r) => r.step === 'tooEasy').grade, Grade.Easy);
  assert.equal([...store.words.values()].filter((w) => w.introducedOn).length, 5, 'a 5th word took its place');
});

test('Ken ik al with no other cards to come in between: the check waits for the next session', async () => {
  const { s, store } = session({ mode: 'learn', settings: { newPerDay: 1 } });
  const seen = await play(s, (sc) => (sc.step === 'intro' ? 'tooEasy' : null));
  assert.deepEqual(seen.map((x) => x.step), ['intro', 'round']);
  assert.equal(s.deferred, 1);
  assert.equal(store.cards.get('1:production').step, 'tooEasy');
  // Next session (the next day): the check comes, and passing it doesn't raise that day's limit.
  const tomorrow = new Date(NOW.getTime() + 864e5);
  const next = session({ mode: 'learn', now: tomorrow, cards: [...store.cards.values()], wordStates: [...store.words.values()], settings: { newPerDay: 2 } });
  const seen2 = await play(next.s);
  assert.equal(seen2.filter((x) => x.step === 'tooEasy').length, 1);
  assert.equal(next.store.log.find((r) => r.step === 'tooEasy').grade, Grade.Easy);
  const today = [...next.store.words.values()].filter((w) => w.introducedOn && w.wordId !== 1);
  assert.equal(today.length, 2, 'a check from yesterday gives no extra new word today');
});

test('Te makkelijk: the check comes in the next round, with other cards in between', async () => {
  // The typed check must test memory, not the word that was on screen a moment ago (§6.2).
  const { s, store } = session({ mode: 'learn', settings: { newPerDay: 4 } });
  const seen = await play(s, (sc) => (sc.step === 'intro' && sc.word.id === 1 ? 'tooEasy' : null));
  const flat = seen.filter((x) => x.step !== 'round');
  const intro = flat.findIndex((x) => x.id === 1 && x.step === 'intro');
  const check = flat.findIndex((x) => x.step === 'tooEasy');
  assert.ok(check - intro - 1 >= 1, 'other cards in between');
  assert.ok(seen.findIndex((x) => x.step === 'round') < seen.findIndex((x) => x.step === 'tooEasy'), 'in a later round');
  assert.equal(store.words.get(1).tooEasy, true);
});

test('Te makkelijk: a check that is still open does not count for "Dit niveau lijkt te makkelijk"', () => {
  const t = (id) => new Date(NOW.getTime() + id * 1000);
  const ws = new Map([1, 2, 3, 4, 5].map((id) => [id, { wordId: id, introducedOn: t(id), tooEasy: true }]));
  ws.set(6, { wordId: 6, introducedOn: t(6), tooEasy: false });
  assert.equal(levelLooksEasy(1, base, ws), false, 'word 6 was learned normally');
  assert.equal(levelLooksEasy(1, base, ws, [], new Set([6])), true, 'word 6 is still waiting for its check');
});

test('Te makkelijk answered wrong → multiple choice next round, then typed; it counts as a miss', async () => {
  const { s, store } = session({ mode: 'learn', settings: { newPerDay: 4 } });
  const seen = await play(s, (sc) => (sc.step === 'intro' && sc.word.id === 1 ? 'tooEasy' : sc.step === 'tooEasy' ? 'slecht' : null));
  assert.deepEqual(seen.filter((x) => x.id === 1).map((x) => x.step), ['intro', 'tooEasy', 'mc', 'type1']);
  assert.equal(store.words.get(1).tooEasy, false);
  assert.equal(store.log.find((r) => r.cardId === '1:production' && r.grade != null).grade, Grade.Hard);
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

test('a card whose word was removed from the data stays stored but hidden (§12.3)', () => {
  const orphan = { ...reviewCard(1, 10), id: '99999:production', wordId: 99999 };
  const { s } = session({ cards: [orphan, reviewCard(2, 10)], settings: { newPerDay: 0 } });
  assert.equal(s.next().word.id, 2);
  s.answerTyped(s.current, 'klein', 1000);
  assert.equal(s.next(), null);
});

test('an unfinished word continues in the next Leren session (an old type2 step counts as typed)', async () => {
  const card = { ...newCard(2, 'production', new Date('2026-10-28T10:00:00+01:00')), step: 'type2' };
  const ws = { wordId: 2, introducedOn: new Date('2026-10-28T10:00:00+01:00'), tooEasy: false, accepted: [] };
  const { s } = session({ mode: 'learn', cards: [card], wordStates: [ws], settings: { newPerDay: 1 } });
  const seen = await play(s);
  assert.equal(seen.find((x) => x.id === 2).step, 'type1');
  assert.ok(seen.slice(0, 2).some((x) => x.id === 2), 'in the first round');
});

test('a miss while learning: the word becomes gekend with Hard instead of Good; a clean run or a first look with Good', async () => {
  const wrong = (sc) => (sc.correct + 1) % 4;
  const cases = [
    ['a wrong first question only', (sc, n) => (n === 0 ? wrong(sc) : null), Grade.Good],
    ['a wrong second multiple choice', (sc, n) => (n <= 1 && sc.step !== 'type1' ? wrong(sc) : null), Grade.Hard],
    ['a typed miss', (sc, n) => (sc.step === 'type1' && n === 1 ? 'falsch' : null), Grade.Hard],
    ['a clean run', () => null, Grade.Good],
  ];
  for (const [name, answer, expected] of cases) {
    const { s, store } = session({ mode: 'learn', settings: { newPerDay: 1 } });
    let n = 0;
    await play(s, (sc) => answer(sc, n++));
    const card = store.cards.get('1:production');
    assert.equal(store.log.find((r) => r.grade != null).grade, expected, name);
    assert.equal(card.fsrs.reps, 1);
    assert.equal(card.missed, undefined, 'the flag is gone after graduating');
  }
});

test('a miss while learning is kept when the session ends before graduating', async () => {
  const { s, store } = session({ mode: 'learn', settings: { newPerDay: 1 } });
  const first = s.next();
  s.answerChoice(first, (first.correct + 1) % 4, 1000);
  assert.equal(s.next().step, 'round');
  s.nextRound();
  const second = s.next();
  assert.equal(second.step, 'mc');
  s.answerChoice(second, (second.correct + 1) % 4, 1000);
  await s.flush();
  assert.equal(store.cards.get('1:production').missed, true);
  const next = session({ mode: 'learn', cards: [...store.cards.values()], wordStates: [...store.words.values()], settings: { newPerDay: 0 } });
  await play(next.s);
  assert.equal(next.store.log.find((r) => r.grade != null).grade, Grade.Hard);
});

test('"Ik had gelijk" on a typed learning step: the miss does not count', async () => {
  const { s, store } = session({ mode: 'learn', settings: { newPerDay: 1 } });
  let overridden = false;
  for (let i = 0; i < 50; i++) {
    const sc = s.next();
    if (!sc) break;
    if (sc.step === 'round') { s.nextRound(); continue; }
    if (sc.step === 'intro' || sc.step === 'mc') s.answerChoice(sc, sc.correct, 1000);
    else if (sc.step === 'type1' && !overridden) {
      s.answerTyped(sc, 'prima', 1000);
      assert.ok(s.override());
      overridden = true;
    } else s.answerTyped(sc, displayForm(sc.word), 1000);
  }
  await s.flush();
  assert.equal(store.log.find((r) => r.grade != null).grade, Grade.Good);
  assert.equal(store.cards.get('1:production').step, null);
});

test('the review log says why an answer was wrong (article, umlaut), for §2', async () => {
  const words = base.map((w) => (w.id === 3 ? { ...w, de: 'schön', nl: ['mooi'] } : w));
  const { s, store } = session({ words, cards: [reviewCard(6, 10), reviewCard(3, 10)], settings: { newPerDay: 0 } });
  s.answerTyped(s.next(), 'die Montag', 1000);
  s.answerTyped(s.next(), 'schon', 1000);
  await s.flush();
  assert.deepEqual(store.log.map((r) => [r.outcome, r.reason]), [['wrong', 'article'], ['wrong', 'umlaut']]);
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

// ---------- levels and the quick scan (§6.1) ----------

// 250 words: levels 1–3 (the last one half full). Word 2 and 3 are confusable (weekdays).
const many = Array.from({ length: 250 }, (_, i) => W(i + 1, `wort${i + 1}`, `woord${i + 1}`, i === 1 || i === 2 ? { groups: ['weekdays'] } : {}));
const planFor = (wordStates, settings = {}, cards = new Map()) => planToday({
  words: many, wordStates, cards, settings: { ...DEFAULT_SETTINGS, ...settings }, seconds: DEFAULT_SECONDS, now: NOW,
});

test('levels: groups of 100 by rank, with how many words were seen', () => {
  assert.equal(LEVEL_SIZE, 100);
  assert.deepEqual([1, 100, 101, 250].map((rank) => levelOf({ rank })), [1, 1, 2, 3]);
  const ws = new Map([[1, { wordId: 1, introducedOn: NOW }], [150, { wordId: 150, introducedOn: NOW }]]);
  const lv = levels(many, ws, [2]);
  assert.deepEqual(lv.map((l) => [l.level, l.from, l.to, l.total, l.seen, l.cefr, l.easy]),
    [[1, 1, 100, 100, 1, 'A1', false], [2, 101, 200, 100, 1, 'A1', true], [3, 201, 300, 50, 0, 'A1', false]]);
  assert.equal(currentLevel(many, ws, []), 1);
  assert.equal(currentLevel(many, ws, [1, 2]), 3, 'levels marked too easy are skipped');
});

test('start level: marks every level before the first A2 (or B1) level, and is read back', () => {
  const lv = [1, 2, 3, 4, 5].map((level, i) => ({ level, cefr: ['A1', 'A1', 'A2', 'A1', 'B1'][i] }));
  assert.deepEqual(levelsBelow(lv, 'A1'), []);
  assert.deepEqual(levelsBelow(lv, 'A2'), [1, 2]);
  assert.deepEqual(levelsBelow(lv, 'B1'), [1, 2, 3, 4]);
  assert.equal(startLevelOf(lv, []), 'A1');
  assert.equal(startLevelOf(lv, [2, 1]), 'A2');
  assert.equal(startLevelOf(lv, [1, 2, 3, 4]), 'B1');
  assert.equal(startLevelOf(lv, [1]), null, 'a hand-picked set is nobody\'s start level');
});

test('a level marked too easy: no new words from it; at most SCANS_PER_DAY words to scan a day', () => {
  const plan = planFor(new Map(), { easyLevels: [1] });
  assert.equal(plan.newLeft, 150);
  assert.equal(plan.scanLeft, 100);
  assert.equal(plan.scanToday, SCANS_PER_DAY);
  assert.equal(pickNewWord(many, new Map(), new Map(), NOW, new Set([1])).id, 101);
  assert.deepEqual(scanBatch(many, new Map(), new Set([1])).map((w) => w.id), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
});

test('the scan: known words go to review (Easy), unknown ones become the next new words', async () => {
  const easy = new Set([1]);
  const page = scanBatch(many, new Map(), easy);
  const missed = page.filter((w) => w.id === 4 || w.id === 7);
  const known = page.filter((w) => !missed.includes(w));
  const out = applyScan({ known, missed, wordStates: new Map(), now: NOW });
  assert.equal(out.cards.length, 8);
  const c1 = out.cards.find((c) => c.wordId === 1);
  assert.deepEqual([c1.step, c1.fsrs.state, c1.fsrs.reps], [null, State.Review, 1]);
  assert.ok(c1.fsrs.due > NOW);
  const ws = new Map(out.wordStates.map((w) => [w.wordId, w]));
  assert.deepEqual(
    (({ levelCheck, tooEasy, scanMissed }) => ({ levelCheck, tooEasy, scanMissed }))(ws.get(1)),
    { levelCheck: true, tooEasy: true, scanMissed: false },
  );
  assert.equal(ws.get(4).introducedOn, undefined);
  assert.deepEqual([ws.get(4).scanMissed, ws.get(4).queuedNext], [true, true]);

  // The next page starts after the scanned words; today's budget shrinks by 10.
  assert.equal(scanBatch(many, ws, easy)[0].id, 11);
  const cards = new Map(out.cards.map((c) => [c.id, c]));
  const plan = planFor(ws, { easyLevels: [1] }, cards);
  assert.equal(plan.scanToday, SCANS_PER_DAY - 10);
  assert.equal(plan.scanLeft, 90);
  assert.equal(plan.newLeft, 152, 'the two unknown words are new words again');
  assert.equal(plan.usedToday, 0, 'known words do not count toward the daily limit');
  assert.equal(currentLevel(many, ws, [1]), 2, 'unknown words from a skipped level do not move the current level back');

  // Leren introduces the unknown words first, as normal new words.
  const { s } = session({ mode: 'learn', words: many, wordStates: out.wordStates, cards: out.cards, settings: { easyLevels: [1], newPerDay: 3 } });
  const seen = await play(s);
  assert.deepEqual(seen.filter((x) => x.step === 'intro').map((x) => x.id).sort((a, b) => a - b), [4, 7, 101]);
});

test('"Dit niveau lijkt te makkelijk": the last 5 new words of a level all passed Te makkelijk', async () => {
  const intro = (ids, tooEasy) => ids.map((id, i) => [id, { wordId: id, introducedOn: new Date(NOW.getTime() + id * 1000 + i), tooEasy }]);
  const five = new Map(intro([1, 2, 3, 4, 5], true));
  assert.equal(levelLooksEasy(1, many, five), true);
  assert.equal(levelLooksEasy(1, many, five, [1]), false, 'not for a level already marked');
  assert.equal(levelLooksEasy(1, many, new Map(intro([1, 2, 3, 4], true))), false, 'four is not enough');
  assert.equal(levelLooksEasy(1, many, new Map([...intro([1], false), ...intro([2, 3, 4, 5, 6], true)])), true, 'only the last five count');
  assert.equal(levelLooksEasy(1, many, new Map([...intro([2, 3, 4, 5], true), ...intro([6], false)])), false);
  assert.equal(levelLooksEasy(2, many, five), false, 'evidence from another level does not count');

  // In a session: offered after the fifth passed Te makkelijk; skipping the level makes the next
  // new words come from level 2.
  const { s, store } = session({ mode: 'learn', words: many, settings: { newPerDay: 7 } });
  let offeredAfter = null;
  const intros = [];
  let introsAfterSkip = null;
  for (let i = 0; i < 60; i++) {
    const sc = s.next();
    if (!sc) break;
    if (sc.step === 'round') {
      s.nextRound();
      continue;
    }
    if (sc.step === 'intro') {
      intros.push(sc.word.id);
      introsAfterSkip?.push(sc.word.id);
      s.answerIntro(sc, 'tooEasy', 1000);
      continue;
    }
    s.answerTyped(sc, displayForm(sc.word), 1000);
    if (offeredAfter == null && s.levelLooksEasy(levelOf(sc.word))) {
      offeredAfter = sc.word.id;
      assert.deepEqual(s.skipLevel(1), { easyLevels: [1], learnLevel: null });
      introsAfterSkip = [];
    }
  }
  await s.flush();
  // Round 1 (shuffled): 7 new words. (Word 3 waits a day: it is in the same confusable set as word 2.)
  assert.deepEqual(intros.slice(0, 7).sort((a, b) => a - b), [1, 2, 4, 5, 6, 7, 8]);
  assert.ok(offeredAfter != null, 'offered once five words were known');
  assert.equal([1, 2, 4, 5, 6, 7, 8].filter((id) => store.words.get(id)?.tooEasy).length >= 5, true);
  // The checks come in the next round, so words 7 and 8 were already introduced.
  assert.ok(introsAfterSkip.length >= 1);
  assert.ok(introsAfterSkip.every((id) => id > 100), 'the next new words come from level 2');
  assert.equal(store.words.get(1).tooEasy, true);
});

// ---------- difficulty and word families (§6.1) ----------

test('difficulty for a Dutch speaker: cognates are easy, false friends and irregular non-cognates hard', () => {
  const haus = W(1, 'Haus', 'huis', { pos: 'noun', article: 'das', nlArticle: 'het' });
  const maedchen = W(2, 'Mädchen', 'meisje', { pos: 'noun', article: 'das', nlArticle: 'het', cognate: false });
  const sonne = W(3, 'Sonne', 'zon', { pos: 'noun', article: 'die', nlArticle: 'de' });
  const bekommen = W(4, 'bekommen', 'krijgen', { pos: 'verb', strong: true, cognate: false });
  const fast = W(5, 'fast', 'bijna', { pos: 'adv', cognate: false, falseFriend: { nl: 'vast', note: '…' } });
  const kind = W(6, 'Kind', 'kind', { pos: 'noun', article: 'das', nlArticle: 'het' });
  const meer = W(7, 'Meer', 'zee', { pos: 'noun', article: 'das', nlArticle: 'de', cognate: false });
  assert.deepEqual([haus, sonne, kind].map(difficultyOf), [0, 0, 0]);
  assert.equal(difficultyOf(maedchen), 2);
  assert.equal(difficultyOf(meer), 3, 'non-cognate + de/het mismatch (de zee → das Meer)');
  assert.equal(difficultyOf(bekommen), 3);
  assert.equal(difficultyOf(fast), 4);
  assert.deepEqual([haus, maedchen, fast].map(difficultyBand), ['easy', 'medium', 'hard']);
});

const hardWord = (id) => W(id, `schwer${id}`, `moeilijk${id}`, { cognate: false, falseFriend: { nl: 'x', note: 'y' } });

test(`hard-word cap: at most ${HARD_PER_DAY} hard new words a day; the next one waits and keeps its place`, () => {
  const words = [...Array.from({ length: 6 }, (_, i) => hardWord(i + 1)), W(7, 'leicht', 'licht'), W(8, 'gut', 'goed')];
  const ws = new Map(Array.from({ length: HARD_PER_DAY }, (_, i) => [i + 1, { wordId: i + 1, introducedOn: NOW, tooEasy: false }]));
  assert.equal(pickNewWord(words, ws, new Map(), NOW).id, 7, 'an easy word comes first');
  const tomorrow = new Date(NOW.getTime() + 864e5);
  assert.equal(pickNewWord(words, ws, new Map(), tomorrow).id, 5, 'the next day the hard word is first again');
  ws.set(4, { wordId: 4, introducedOn: NOW, tooEasy: true });
  assert.equal(pickNewWord(words, ws, new Map(), NOW).id, 5, 'a hard word passed with Te makkelijk does not count');
});

test('word families: a word waits until its base word has been introduced', () => {
  const words = [W(1, 'Fahrrad', 'fiets', { base: 2 }), W(2, 'fahren', 'rijden'), W(3, 'gut', 'goed')];
  assert.equal(pickNewWord(words, new Map(), new Map(), NOW).id, 2, 'Fahrrad waits for fahren');
  const ws = new Map([[2, { wordId: 2, introducedOn: new Date('2026-10-01') }]]);
  assert.equal(pickNewWord(words, ws, new Map(), NOW).id, 1);
  assert.equal(pickNewWord([W(1, 'Fahrrad', 'fiets', { base: 99 })], new Map(), new Map(), NOW).id, 1, 'a base not in the data does not block');
});

test('the real word data: every base exists, and the order puts it first', () => {
  const words = WORD_FILES.flatMap((f) => JSON.parse(readFileSync(f, 'utf8')));
  const byId = new Map(words.map((w) => [w.id, w]));
  for (const w of words.filter((x) => x.base != null)) {
    assert.ok(byId.has(w.base), `${w.de}: base ${w.base}`);
    assert.ok(byId.get(w.base).rank < w.rank, `${w.de} after ${byId.get(w.base).de}`);
  }
});

// ---------- context sets (§4.2 contextSet) ----------

test('context sets: siblings are the multiple-choice options and are not introduced on the same day', () => {
  const words = [
    W(1, 'zu', 'naar', { pos: 'prep', contextSet: 'naar', rule: 'r' }),
    W(2, 'nach', 'naar', { pos: 'prep', contextSet: 'naar', rule: 'r' }),
    ...Array.from({ length: 20 }, (_, i) => W(i + 3, `vor${i}`, `voorz${i}`, { pos: 'prep' })),
  ];
  const { options } = mcOptions(words[0], words, () => 0.5);
  assert.ok(options.includes('nach'), 'the sibling is an option');
  assert.ok(options.includes('zu'));
  assert.equal(options.length, 4);
  const ws = new Map([[1, { wordId: 1, introducedOn: NOW, tooEasy: false }]]);
  const cards = new Map([['1:production', { ...newCard(1, 'production', NOW), step: 'mc' }]]);
  assert.equal(pickNewWord(words, ws, cards, NOW).id, 3, 'nach waits while zu is in learning');
});

test('context sets: a "different" answer gives no first letter (the sentence is the help)', () => {
  const words = [
    W(1, 'nur', 'maar', { pos: 'adv', contextSet: 'maar', rule: 'r' }),
    W(2, 'aber', 'maar', { pos: 'conj', contextSet: 'maar', rule: 'r' }),
    W(3, 'bloß', 'maar', { pos: 'adv', clozeOnly: true }),
  ];
  const card = { ...newCard(1, 'production', NOW), step: 'type1' };
  const { s } = session({ mode: 'learn', words, cards: [card], wordStates: [{ wordId: 1, introducedOn: NOW, tooEasy: false, accepted: [] }] });
  const sc = s.next();
  assert.equal(s.answerTyped(sc, 'bloß').outcome, 'different');
  assert.equal(sc.hint, null);
  assert.equal(s.answerTyped(sc, 'aber').sibling, 'aber');
});

// ---------- choosing a level, progress, Toets (§6.2, §6.4) ----------

test('Leren with a chosen level: new words come from that level only', async () => {
  const { s, store } = session({ mode: 'learn', words: many, settings: { newPerDay: 5, learnLevel: 2 } });
  await play(s);
  const introduced = [...store.words.values()].filter((w) => w.introducedOn).map((w) => w.wordId);
  assert.equal(introduced.length, 5);
  assert.ok(introduced.every((id) => levelOf(many.find((w) => w.id === id)) === 2));
  const plan = planToday({ words: many, wordStates: new Map(), cards: new Map(), settings: { ...DEFAULT_SETTINGS, learnLevel: 2 }, seconds: DEFAULT_SECONDS, now: NOW });
  assert.equal(plan.newToday, DEFAULT_SETTINGS.newPerDay);
});

test('level progress: gekend, bezig and nieuw per level', async () => {
  const { s, store } = session({ mode: 'learn', words: many, settings: { newPerDay: 3 } });
  let n = 0;
  // Stop halfway: the first round's words are answered, nothing typed yet.
  for (let sc = s.next(); sc && sc.step !== 'round'; sc = s.next()) { s.answerChoice(sc, sc.correct, 1000); n++; }
  await s.flush();
  assert.equal(n, 3);
  assert.deepEqual(levelProgress(many, store.cards, 1), { level: 1, total: 100, known: 0, learning: 3, fresh: 97 });
  const cards = new Map([...store.cards, ['5:production', reviewCard(5, 3)]]);
  assert.deepEqual(levelProgress(many, cards, 1), { level: 1, total: 100, known: 1, learning: 3, fresh: 96 });
});

test('Toets: learned words of the level, typed, scored; a rating counts once per word per day', async () => {
  const cards = [1, 2, 4, 5, 101].map((id) => reviewCard(id, 2));
  cards[1] = { ...cards[1], fsrs: { ...cards[1].fsrs, last_review: new Date(NOW.getTime() - 3600e3) } }; // word 2: reviewed today
  assert.deepEqual(testCards(many, new Map(cards.map((c) => [c.id, c])), 1).map((c) => c.wordId).sort(), [1, 2, 4, 5]);
  const { s, store } = session({ mode: 'test', level: 1, words: many, cards });
  const seen = await play(s, (sc) => (sc.word.id === 4 ? 'falsch' : null));
  assert.equal(seen.length, 4);
  assert.ok(seen.every((x) => x.step === 'test'));
  assert.deepEqual(s.results.map((r) => [r.wordId, r.ok]).sort((a, b) => a[0] - b[0]), [[1, true], [2, true], [4, false], [5, true]]);
  const graded = store.log.filter((r) => r.grade != null).map((r) => [Number(r.cardId.split(':')[0]), r.grade]).sort((a, b) => a[0] - b[0]);
  assert.deepEqual(graded, [[1, Grade.Good], [4, Grade.Again], [5, Grade.Good]], 'word 2 was already reviewed today: practice only');
  assert.equal(store.cards.get('4:production').fsrs.lapses, 1);
  assert.equal(store.cards.get('4:production').step, null, 'no relearning step in a Toets');
});

test(`Toets: at most ${TEST_SIZE} words`, () => {
  const cards = Array.from({ length: 30 }, (_, i) => reviewCard(i + 1, 3));
  const { s } = session({ mode: 'test', level: 1, words: many, cards });
  assert.equal(s.total, TEST_SIZE);
});

test('skipping the chosen level: new words follow the normal order again', () => {
  const { s } = session({ mode: 'learn', words: many, settings: { newPerDay: 3, learnLevel: 1 } });
  assert.deepEqual(s.skipLevel(1), { easyLevels: [1], learnLevel: null });
  assert.deepEqual(s.skipLevel(3), { easyLevels: [1, 3], learnLevel: null });
});

test('Leren: stopping halfway leaves the new words not asked yet untouched', async () => {
  const { s, store } = session({ mode: 'learn', settings: { newPerDay: 10 } });
  s.answerChoice(s.next(), 0, 1000);
  await s.flush();
  assert.equal([...store.words.values()].filter((w) => w.introducedOn).length, 1);
  assert.equal(store.cards.size, 1);
  assert.equal(s.stats.newWords, 1);
});

test('a chosen level brings the base words its words wait for, so none get stuck', async () => {
  // Word 250 (level 3) builds on word 5 (level 1).
  const ws = many.map((w) => (w.id === 250 ? { ...w, base: 5 } : w));
  const reach = levelReach(ws, new Map(), new Set(), 3);
  assert.ok(reach.has(250) && reach.has(5));
  // Everything else of level 3 done: Leren still gives 2 words (Vater first, then Großvater).
  const states = new Map(ws.filter((w) => levelOf(w) === 3 && w.id !== 250).map((w) => [w.id, { wordId: w.id, introducedOn: new Date('2026-10-01') }]));
  const plan = planToday({ words: ws, wordStates: states, cards: new Map(), settings: { ...DEFAULT_SETTINGS, learnLevel: 3 }, seconds: DEFAULT_SECONDS, now: NOW });
  assert.equal(plan.newToday, 2, 'the base word first, then the word that builds on it');
  const { s, store } = session({ mode: 'learn', words: ws, wordStates: [...states.values()], settings: { newPerDay: 5, learnLevel: 3 } });
  await play(s);
  assert.ok(store.words.get(5)?.introducedOn, 'the base word was learned');
  assert.ok(store.words.get(250)?.introducedOn, 'and then the word built on it');
});

test('Home and Leren agree on the number of new words: every rule counts (here the confusable rule)', () => {
  // Words 2 and 3 are both weekdays: with only those two left in reach, one comes today.
  const states = new Map(many.filter((w) => w.id !== 2 && w.id !== 3 && levelOf(w) === 1).map((w) => [w.id, { wordId: w.id, introducedOn: new Date('2026-10-01') }]));
  const plan = planToday({ words: many, wordStates: states, cards: new Map(), settings: { ...DEFAULT_SETTINGS, learnLevel: 1 }, seconds: DEFAULT_SECONDS, now: NOW });
  assert.equal(plan.newToday, 1);
});

test('a chosen level marked too easy since: the normal order again', () => {
  assert.equal(chosenLevel({ learnLevel: 2, easyLevels: [] }), 2);
  assert.equal(chosenLevel({ learnLevel: 2, easyLevels: [2] }), null);
  assert.equal(chosenLevel({ learnLevel: null }), null);
  const plan = planToday({ words: many, wordStates: new Map(), cards: new Map(), settings: { ...DEFAULT_SETTINGS, learnLevel: 2, easyLevels: [2] }, seconds: DEFAULT_SECONDS, now: NOW });
  assert.equal(plan.newToday, DEFAULT_SETTINGS.newPerDay);
});

test('level progress: a lapsed word waiting for its relearning step stays gekend', () => {
  const c = { ...reviewCard(5, 3), step: 'relearn' };
  assert.deepEqual(levelProgress(many, new Map([[c.id, c]]), 1), { level: 1, total: 100, known: 1, learning: 0, fresh: 99 });
});
