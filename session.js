// Session flow (PLAN §6, §8.2): which card comes next, the learning steps of new words, lapses
// and relearning. Pure logic: the screens come from cards.js, persistence goes through `store`.
// session.js decides only *when within a session* a card comes back; srs.js (FSRS) decides its
// schedule, with one rating at graduation, at Te makkelijk, or at a review answer.
import { grade, gradeToRating, displayForm, normalize, buildIndex } from './grading.js';
import {
  Grade, CARD_TYPES, newCard, rate, isDue, dayKey, retrievability, applySiblingsRule, newWordsPaused,
} from './srs.js';

// Every word file, in rank order (all of them are precached by sw.js).
export const WORD_FILES = ['words/words-0001-0500.json', 'words/words-0501-1000.json', 'words/words-1001-1500.json', 'words/words-1501-2000.json'];

export const REVIEWS_PER_NEW = 4;
// How many other cards must come in between (§6.2).
// tooEasy: the Te makkelijk check comes after a few other cards, not straight after the intro
// that showed the German word, so it tests memory rather than what is still on screen in the
// learner's head (§6.2).
export const GAP = { type1: 3, type2: 8, mcAgain: 3, typeMiss: 2, relearn: 5, tooEasy: 3 };
export const LEARN_STEPS = ['intro', 'mc', 'type1', 'type2', 'tooEasy'];
const STEPS_LEFT = { intro: 4, tooEasy: 4, mc: 3, type1: 2, type2: 1, relearn: 1 };

// ---------- levels (§6.1) ----------

// Words are grouped by frequency rank into levels of 100: level 1 is ranks 1–100, and so on.
export const LEVEL_SIZE = 100;
// A word from a level marked "te makkelijk" isn't introduced as a new word. It comes in the quick
// scan instead (Home → "Snel doorlopen"): a list of SCAN_PAGE words where the owner taps the ones
// he doesn't know. At most SCANS_PER_DAY a day (fixed), so their first reviews don't all land on
// the same day.
export const SCANS_PER_DAY = 30;
export const SCAN_PAGE = 10;
// "Dit niveau lijkt te makkelijk": offered when the last EASY_STREAK new words of a level all
// passed Te makkelijk.
export const EASY_STREAK = 5;

export const levelOf = (w) => Math.max(1, Math.ceil(w.rank / LEVEL_SIZE));
const easySet = (settings) => new Set(settings?.easyLevels || []);

// Every level in the data, with how many of its words have been seen. `cefr` is the most common
// `level` label among its words.
export function levels(words, wordStates, easyLevels = []) {
  const easy = new Set(easyLevels);
  const byLevel = new Map();
  for (const w of words) {
    if (w.clozeOnly) continue;
    const n = levelOf(w);
    const l = byLevel.get(n) || { level: n, from: (n - 1) * LEVEL_SIZE + 1, to: n * LEVEL_SIZE, total: 0, seen: 0, labels: {} };
    l.total++;
    if (wordStates.get(w.id)?.introducedOn) l.seen++;
    if (w.level) l.labels[w.level] = (l.labels[w.level] || 0) + 1;
    byLevel.set(n, l);
  }
  return [...byLevel.values()].sort((a, b) => a.level - b.level).map(({ labels, ...l }) => ({
    ...l, cefr: Object.entries(labels).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null, easy: easy.has(l.level),
  }));
}

// The level new words come from now: that of the first word still to be introduced outside the
// levels marked too easy (words the scan sent back from those levels don't move it back).
export function currentLevel(words, wordStates, easyLevels = []) {
  const easy = new Set(easyLevels);
  const next = [...words].sort((a, b) => a.rank - b.rank).find((w) => !easy.has(levelOf(w)) && isNewCandidate(w, wordStates.get(w.id), easy));
  return next ? levelOf(next) : null;
}

// The CEFR levels the owner can start at (Instellingen → Niveaus → "Ik begin bij"). Starting at A2
// marks every level before the first A2-or-higher level as too easy; A1 marks none.
export const START_LEVELS = ['A1', 'A2', 'B1'];
const LEVEL_ORDER = ['A1', 'A2', 'B1', 'B2', 'C1'];
export function levelsBelow(levelList, cefr) {
  const at = levelList.findIndex((l) => l.cefr && LEVEL_ORDER.indexOf(l.cefr) >= LEVEL_ORDER.indexOf(cefr));
  return levelList.slice(0, at < 0 ? levelList.length : at).map((l) => l.level);
}

// Which start level the current "too easy" levels match exactly, or null (own choice).
export function startLevelOf(levelList, easyLevels) {
  const easy = [...new Set(easyLevels)].sort((a, b) => a - b).join(',');
  return START_LEVELS.find((c) => levelsBelow(levelList, c).join(',') === easy) ?? null;
}

// True when the last EASY_STREAK words introduced from this level (not via the scan) all passed
// Te makkelijk, and the level still has new words: then the app offers to skip the rest of it.
// `pending`: ids of words whose Te makkelijk check hasn't come yet; they don't count either way.
export function levelLooksEasy(level, words, wordStates, easyLevels = [], pending = new Set()) {
  if (level == null || easyLevels.includes(level)) return false;
  const inLevel = new Set(words.filter((w) => levelOf(w) === level).map((w) => w.id));
  const recent = [...wordStates.values()]
    .filter((ws) => ws.introducedOn && !ws.levelCheck && inLevel.has(ws.wordId) && !pending.has(ws.wordId))
    .sort((a, b) => new Date(b.introducedOn) - new Date(a.introducedOn))
    .slice(0, EASY_STREAK);
  const easy = new Set(easyLevels);
  const left = words.some((w) => inLevel.has(w.id) && isNewCandidate(w, wordStates.get(w.id), easy));
  return left && recent.length === EASY_STREAK && recent.every((ws) => ws.tooEasy);
}

// ---------- difficulty for a Dutch speaker (§6.1) ----------

// How hard a word is to learn for a Dutch speaker, from fields the data already has. This is
// separate from `level` (how advanced it is): Haus is A1 and easy, Mädchen is A1 and not.
export function difficultyOf(w) {
  let d = 0;
  if (!w.cognate) d += 2;
  if (w.falseFriend) d += 2;
  if (w.pos === 'noun' && w.nlArticle && ((w.nlArticle === 'het') !== (w.article === 'das'))) d += 1;
  if (w.pos === 'verb' && w.strong) d += 1;
  if (w.separable) d += 1;
  if (w.reflexive || w.governs) d += 1;
  if (w.pos === 'phrase') d += 1;
  if (w.de.length > 10) d += 1;
  return d;
}

// Bands: 0–1 easy, 2–3 medium, 4+ hard.
export const difficultyBand = (w) => { const d = difficultyOf(w); return d >= 4 ? 'hard' : d >= 2 ? 'medium' : 'easy'; };
export const isHard = (w) => difficultyBand(w) === 'hard';

// At most this many hard new words a day (a fixed number), so no day is all hard words.
export const HARD_PER_DAY = 4;

// ---------- choosing new words (§6.1) ----------

// A word counts toward today's limit when it was introduced today, unless it passed Te makkelijk
// or was marked known in the scan.
export function countsTowardLimit(ws, now) {
  return !!ws?.introducedOn && dayKey(ws.introducedOn) === dayKey(now) && !ws.tooEasy && !ws.levelCheck;
}

const unseen = (w, ws) => !w.clozeOnly && !ws?.introducedOn;
// A word from a level marked too easy is a new word only after the scan said "don't know".
export const isNewCandidate = (w, ws, easy = new Set()) => unseen(w, ws) && (!easy.has(levelOf(w)) || !!ws?.scanMissed);
export const isScanCandidate = (w, ws, easy = new Set()) => unseen(w, ws) && easy.has(levelOf(w)) && !ws?.scanMissed;

export function newWordsLeft(words, wordStates, easy = new Set()) {
  return words.filter((w) => isNewCandidate(w, wordStates.get(w.id), easy)).length;
}

export function scanLeft(words, wordStates, easy = new Set()) {
  return words.filter((w) => isScanCandidate(w, wordStates.get(w.id), easy)).length;
}

// The confusable labels of a word: its `groups`, plus its context set (zu and nach aren't
// introduced on the same day either).
const confusables = (w) => (w.contextSet ? [...w.groups, `set:${w.contextSet}`] : w.groups);

// Group labels of words still in a learning step.
function learningGroups(words, cards, extraBusy = new Set()) {
  const busy = new Set(extraBusy);
  for (const c of cards.values()) if (LEARN_STEPS.includes(c.step)) busy.add(c.wordId);
  const blocked = new Set();
  for (const w of words) if (busy.has(w.id)) for (const g of confusables(w)) blocked.add(g);
  return blocked;
}

// Hard-word cap: a hard word waits (and keeps its place) once HARD_PER_DAY hard words that count
// toward today's limit have been introduced.
export function hardCapReached(words, wordStates, now) {
  const byId = new Map(words.map((w) => [w.id, w]));
  let n = 0;
  for (const ws of wordStates.values()) {
    const w = byId.get(ws.wordId);
    if (w && countsTowardLimit(ws, now) && isHard(w)) n++;
  }
  return n >= HARD_PER_DAY;
}

// Word families: a word that builds on another (`base`: Fahrrad → fahren, Spaß machen → Spaß)
// waits until its base word has been introduced. A base that isn't in the data doesn't block.
export function baseReady(w, wordStates, wordIds) {
  return w.base == null || !wordIds.has(w.base) || !!wordStates.get(w.base)?.introducedOn;
}

// Picks the next new word. It is the first in rank order that passes every rule; a word that
// waits keeps its place. Words queued with "Leer dit als volgende" go first.
// - Confusable-set rule: no word that shares a `groups` label with a word introduced today or
//   still in learning. A word marked known in the scan doesn't count (it was known already).
// - Hard-word cap and word families (above).
export function pickNewWord(words, wordStates, cards, now, easy = new Set()) {
  const today = dayKey(now);
  const introduced = new Set();
  for (const ws of wordStates.values()) {
    if (ws.introducedOn && dayKey(ws.introducedOn) === today && !(ws.levelCheck && ws.tooEasy)) introduced.add(ws.wordId);
  }
  const blocked = learningGroups(words, cards, introduced);
  const capped = hardCapReached(words, wordStates, now);
  const wordIds = new Set(words.map((w) => w.id));
  const free = (w) => isNewCandidate(w, wordStates.get(w.id), easy) && !confusables(w).some((g) => blocked.has(g))
    && !(capped && isHard(w)) && baseReady(w, wordStates, wordIds);
  return words.find((w) => free(w) && wordStates.get(w.id)?.queuedNext) || words.find(free) || null;
}

// ---------- the quick scan of levels marked too easy (§6.1) ----------

// How many words were scanned today (known or not).
export function scannedToday(wordStates, now) {
  const today = dayKey(now);
  return [...wordStates.values()].filter((ws) => ws.scannedOn && dayKey(ws.scannedOn) === today).length;
}

// The next words to scan, in rank order.
export function scanBatch(words, wordStates, easy, n = SCAN_PAGE) {
  return [...words].sort((a, b) => a.rank - b.rank).filter((w) => isScanCandidate(w, wordStates.get(w.id), easy)).slice(0, n);
}

// The records to store for one scanned page. Known words go straight to review with an Easy first
// rating (like a passed Te makkelijk; they don't count toward the daily limit). Words the owner
// doesn't know become new words, queued first (like "Leer dit als volgende").
export function applyScan({ known, missed, wordStates, now, retention = 0.9 }) {
  const base = (w) => ({ knownMarked: false, queuedNext: false, accepted: [], ...wordStates.get(w.id), wordId: w.id, scannedOn: now });
  return {
    wordStates: [
      ...known.map((w) => ({ ...base(w), introducedOn: now, levelCheck: true, tooEasy: true, scanMissed: false })),
      ...missed.map((w) => ({ ...base(w), scanMissed: true, queuedNext: true })),
    ],
    cards: known.map((w) => ({ ...rate(newCard(w.id, 'production', now), Grade.Easy, now, retention), step: null })),
  };
}

// ---------- today's plan, shared by Home and the session (§8.2) ----------

export function planToday({ words, wordStates, cards, settings, seconds, now }) {
  // A word removed from the data keeps its progress, hidden (§12.3): its cards are left out.
  const known = new Set(words.map((w) => w.id));
  const all = [...cards.values()].filter((c) => known.has(c.wordId));
  const typeRank = (c) => CARD_TYPES.indexOf(c.type);
  const due = all.filter((c) => isDue(c, now))
    .map((c) => ({ c, r: retrievability(c, now, settings.retention) }))
    .sort((a, b) => typeRank(a.c) - typeRank(b.c) || a.r - b.r)
    .map((x) => x.c);
  const reviews = applySiblingsRule(due, all, now);
  const learning = all.filter((c) => !c.suspended && (LEARN_STEPS.includes(c.step) || c.step === 'relearn'));
  const paused = newWordsPaused(reviews, seconds);
  const easy = easySet(settings);
  const usedToday = [...wordStates.values()].filter((ws) => countsTowardLimit(ws, now)).length;
  const left = newWordsLeft(words, wordStates, easy);
  const newToday = paused ? 0 : Math.max(0, Math.min(settings.newPerDay - usedToday, left));
  // The scan adds reviews later, so it pauses together with new words.
  const toScan = scanLeft(words, wordStates, easy);
  const scanToday = paused ? 0 : Math.max(0, Math.min(SCANS_PER_DAY - scannedToday(wordStates, now), toScan));
  return { reviews, learning, paused, newToday, newLeft: left, usedToday, scanToday, scanLeft: toScan };
}

// ---------- multiple choice (§6.2 step 2) ----------

// Four German options: same part of speech and similar rank; nouns with their article, and one
// distractor is the same noun with a wrong article. Never another valid answer for the prompt.
export function mcOptions(word, words, random = Math.random) {
  const right = displayForm(word);
  const prompt = normalize(word.nl[0]);
  const valid = new Set([right, ...(word.acceptAlso || []), ...(word.variants || [])].map((s) => normalize(s)));
  const usable = (w) => w.id !== word.id && !w.clozeOnly && w.de !== word.de && !w.nl.some((n) => normalize(n) === prompt)
    && !valid.has(normalize(displayForm(w)));
  const pick = (pool, n) => {
    const out = [];
    const p = [...pool];
    while (out.length < n && p.length) out.push(p.splice(Math.floor(random() * p.length), 1)[0]);
    return out;
  };
  // A word from a context set gets its siblings as options: its sentence shows which one is meant.
  const distractors = word.contextSet
    ? words.filter((w) => w.id !== word.id && w.contextSet === word.contextSet && !w.clozeOnly).map(displayForm).slice(0, 3)
    : [];
  if (word.pos === 'noun' && distractors.length < 3) {
    const wrong = ['der', 'die', 'das'].filter((a) => a !== word.article);
    distractors.push(`${wrong[Math.floor(random() * wrong.length)]} ${word.de}`);
  }
  const need = 3 - distractors.length;
  for (const span of [40, 120, 400, Infinity]) {
    const pool = words.filter((w) => usable(w) && w.pos === word.pos && Math.abs(w.rank - word.rank) <= span);
    if (pool.length >= need || span === Infinity) {
      const extra = pick(pool, need);
      if (extra.length < need) extra.push(...pick(words.filter((w) => usable(w) && !extra.includes(w)), need - extra.length));
      distractors.push(...extra.map(displayForm));
      break;
    }
  }
  const options = [right, ...distractors];
  for (let i = options.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [options[i], options[j]] = [options[j], options[i]];
  }
  return { options, correct: options.indexOf(right) };
}

// ---------- the session ----------

// store: { putCard(card), putWord(wordState), addLog(row) → key, updateLog(key, row), addReport(row) },
// each returning a promise. The session itself is synchronous, so the UI can show the next card
// inside the same tap (iOS only opens the keyboard then); every write is queued at once, in
// order, and `flush()` waits for them. A failed write goes to `onError`.
export class Session {
  constructor({ words, wordStates, cards, settings, seconds, store, now = () => new Date(), random = Math.random, onError = () => {} }) {
    this.words = [...words].sort((a, b) => a.rank - b.rank);
    this.wordsById = new Map(this.words.map((w) => [w.id, w]));
    this.index = buildIndex(this.words);
    this.wordStates = new Map([...wordStates].map((ws) => [ws.wordId, ws]));
    this.cards = new Map([...cards].map((c) => [c.id, c]));
    this.settings = settings;
    this.store = store;
    this.now = now;
    this.random = random;
    this.onError = onError;
    this.pending = Promise.resolve();
    const plan = planToday({ words: this.words, wordStates: this.wordStates, cards: this.cards, settings, seconds, now: now() });
    this.reviews = plan.reviews.map((c) => ({ kind: 'review', cardId: c.id, step: 'review' }));
    // Unfinished words continue first; a Te-makkelijk card that was cut off shows its intro again.
    this.learning = plan.learning.map((c) => ({
      kind: c.step === 'relearn' ? 'relearn' : 'learn', cardId: c.id, step: c.step === 'tooEasy' ? 'intro' : c.step, after: null, readyAt: 0,
    }));
    this.easy = easySet(settings);
    this.newRemaining = plan.newToday;
    this.paused = plan.paused;
    this.shown = 0;
    this.reviewsSinceNew = 0;
    this.current = null;
    this.last = null;
    this.stats = { done: 0, ms: 0, newWords: 0, reviews: 0 };
  }

  // Queues a write; returns a promise of its result (undefined if it failed).
  persist(fn) {
    const p = this.pending.then(fn);
    this.pending = p.then(() => {}, (e) => this.onError(e));
    return p.catch(() => undefined);
  }

  flush() {
    return this.pending;
  }

  // Count-based progress for the bar.
  progress() {
    const left = this.reviews.length + this.newRemaining * STEPS_LEFT.intro
      + this.learning.reduce((s, i) => s + (STEPS_LEFT[i.step] || 1), 0) + (this.current ? 1 : 0);
    return this.shown / Math.max(1, this.shown + left);
  }

  // The next screen, or null when today's work is done (§8.2 order).
  next() {
    if (this.current) return this.current;
    const item = this.pickItem();
    if (!item) return null;
    const card = this.cards.get(item.cardId);
    const word = this.wordsById.get(card.wordId);
    const screen = { item, step: item.step, card, word, hint: null };
    if (item.step === 'mc') Object.assign(screen, mcOptions(word, this.words, this.random));
    if (word.showInitial && ['type1', 'type2', 'tooEasy', 'review', 'relearn'].includes(item.step)) screen.hint = word.de[0];
    this.current = screen;
    return screen;
  }

  pickItem() {
    const ready = this.learning.filter((i) => i.readyAt <= this.shown).sort((a, b) => a.readyAt - b.readyAt);
    if (ready.length) return ready[0];
    const wantNew = this.newRemaining > 0 && (!this.reviews.length || this.reviewsSinceNew >= REVIEWS_PER_NEW);
    if (wantNew) {
      const item = this.introduceNext();
      if (item) return item;
    }
    if (this.reviews.length) return this.reviews.shift();
    // Near the end: nothing else left, so a waiting step comes now.
    if (this.learning.length) return [...this.learning].sort((a, b) => a.readyAt - b.readyAt)[0];
    return null;
  }

  introduceNext() {
    const now = this.now();
    const w = pickNewWord(this.words, this.wordStates, this.cards, now, this.easy);
    if (!w) return null;
    this.newRemaining--;
    this.reviewsSinceNew = 0;
    const ws = { knownMarked: false, queuedNext: false, accepted: [], ...this.wordStates.get(w.id), wordId: w.id, introducedOn: now, tooEasy: false };
    ws.queuedNext = false;
    this.putWord(ws);
    this.saveCard(newCard(w.id, 'production', now));
    this.stats.newWords++;
    const item = { kind: 'learn', cardId: `${w.id}:production`, step: 'intro', after: null, readyAt: 0 };
    this.learning.push(item);
    return item;
  }

  // "Dit niveau lijkt te makkelijk" (§6.1), for the level of the word just answered.
  levelLooksEasy(level) {
    const pending = new Set(this.learning.filter((i) => i.step === 'tooEasy').map((i) => this.cards.get(i.cardId).wordId));
    return levelLooksEasy(level, this.words, this.wordStates, [...this.easy], pending);
  }

  // Skips the rest of a level from now on: its words no longer come as new words in this session
  // either. Returns the new list of levels marked too easy, for the caller to store.
  skipLevel(level) {
    this.easy.add(level);
    const easyLevels = [...this.easy].sort((a, b) => a - b);
    this.settings = { ...this.settings, easyLevels };
    return easyLevels;
  }

  saveCard(card) {
    this.cards.set(card.id, card);
    this.persist(() => this.store.putCard(card));
  }

  putWord(ws) {
    this.wordStates.set(ws.wordId, ws);
    this.persist(() => this.store.putWord(ws));
  }

  setStep(item, step, readyAt) {
    item.step = step;
    item.readyAt = readyAt;
    this.saveCard({ ...this.cards.get(item.cardId), step });
  }

  graduate(item, rating, now) {
    this.learning = this.learning.filter((i) => i !== item);
    const { missed, ...card } = this.cards.get(item.cardId);
    this.saveCard({ ...rate(card, rating, now, this.settings.retention), step: null });
    return rating;
  }

  // A miss while learning (multiple choice, a typing step, or the Te makkelijk check) is stored on
  // the card, so it survives the end of a session; the word then graduates with Hard (§8.1).
  markMissed(item) {
    const card = this.cards.get(item.cardId);
    if (!card.missed) this.saveCard({ ...card, missed: true });
  }

  log(screen, ms, fields) {
    const row = { cardId: screen.card.id, ts: this.now(), grade: null, answer: null, ms, practice: false, step: screen.step, ...fields };
    return { key: this.persist(() => this.store.addLog(row)), row };
  }

  resolved(screen, ms) {
    this.current = null;
    this.shown++;
    this.stats.done++;
    this.stats.ms += ms;
    if (screen.step === 'review') {
      this.reviewsSinceNew++;
      this.stats.reviews++;
    }
  }

  // Intro card: 'continue' or 'tooEasy'.
  answerIntro(screen, action, ms = 0) {
    this.log(screen, ms, { outcome: action });
    this.resolved(screen, ms);
    if (action === 'tooEasy') this.setStep(screen.item, 'tooEasy', this.shown + GAP.tooEasy);
    else this.setStep(screen.item, 'mc', this.shown);
    return { action };
  }

  // Multiple choice. A miss shows the intro again; the multiple choice comes back later.
  answerChoice(screen, choice, ms = 0) {
    const correct = choice === screen.correct;
    this.log(screen, ms, { answer: screen.options[choice], outcome: correct ? 'correct' : 'wrong' });
    this.resolved(screen, ms);
    const { item } = screen;
    if (!correct) this.markMissed(item);
    if (correct) {
      const step = item.after || 'type1';
      item.after = null;
      this.setStep(item, step, this.shown + GAP.type1);
    } else {
      this.setStep(item, 'mc', this.shown + GAP.mcAgain);
    }
    return { correct, correctIndex: screen.correct, showIntro: !correct };
  }

  // A typed answer (learning step, Te makkelijk, review or relearning step).
  answerTyped(screen, input, ms = 0) {
    const ws = this.wordStates.get(screen.word.id);
    const result = grade(input, screen.word, {
      index: this.index,
      ignoreCase: this.settings.ignoreCase,
      umlautShortcuts: this.settings.umlautShortcuts,
      accepted: ws?.accepted || [],
    });
    const now = this.now();
    const { item } = screen;
    if (result.outcome === 'different') {
      this.log(screen, ms, { answer: input, outcome: 'different' });
      // The first letter helps, except for a context set: there the sentence is the help (§4.2).
      if (!screen.word.contextSet) screen.hint = screen.word.de[0];
      screen.retried = true;
      return { ...result, rated: null };
    }
    const passed = result.outcome === 'correct' || result.outcome === 'almost';
    const prevCard = this.cards.get(item.cardId);
    let rated = null;
    let relearn = null;
    this.resolved(screen, ms);

    if (item.kind === 'review') {
      rated = gradeToRating(result.outcome);
      let card = rate(prevCard, rated, now, this.settings.retention);
      if (rated === Grade.Again) {
        // Lapse: rated Again once, now; one relearning typing step later (not rated).
        relearn = { kind: 'relearn', cardId: card.id, step: 'relearn', after: null, readyAt: this.shown + GAP.relearn };
        this.learning.push(relearn);
        card = { ...card, step: 'relearn' };
      }
      this.saveCard(card);
    } else if (item.kind === 'relearn') {
      if (passed) {
        this.learning = this.learning.filter((i) => i !== item);
        this.saveCard({ ...prevCard, step: null });
      } else {
        item.readyAt = this.shown + GAP.relearn;
      }
    } else if (item.step === 'tooEasy') {
      if (result.outcome === 'correct') rated = this.passTooEasy(item, now);
      else {
        this.markMissed(item);
        this.setStep(item, 'mc', this.shown);
      }
    } else if (passed) {
      rated = this.passTyping(item, now);
    } else {
      // A miss in a typing step: multiple choice once more, then the same typing step again.
      this.markMissed(item);
      item.after = item.step;
      this.setStep(item, 'mc', this.shown + GAP.typeMiss);
    }
    // `reason` (article, umlaut, plural, form) is what §2 needs to decide on a gender drill.
    const { key, row } = this.log(screen, ms, { answer: input, outcome: result.outcome, grade: rated, reason: result.reason });
    this.last = { screen, input, result, prevCard, relearn, logKey: key, logRow: row, at: now };
    return { ...result, rated, graduated: rated != null && item.kind === 'learn' };
  }

  passTyping(item, now) {
    if (item.step === 'type1') {
      this.setStep(item, 'type2', this.shown + GAP.type2);
      return null;
    }
    // A word that went wrong somewhere while learning starts with Hard: FSRS sets a card's
    // difficulty and first interval from its first rating, and Anki feeds it every learning-step
    // answer, so a miss there counts. Here one rating stands for all of them (§8.1).
    return this.graduate(item, this.cards.get(item.cardId).missed ? Grade.Hard : Grade.Good, now);
  }

  passTooEasy(item, now) {
    this.putWord({ ...this.wordStates.get(this.cards.get(item.cardId).wordId), tooEasy: true });
    // Te makkelijk doesn't count toward the daily limit.
    this.newRemaining++;
    return this.graduate(item, Grade.Easy, now);
  }

  // "Ik had gelijk" (§7.5) on the last typed answer: re-grade it as Good and accept that answer
  // for this word from now on. Only when grading offered it.
  override() {
    const last = this.last;
    if (!last || !last.result.canOverride || last.overridden) return null;
    last.overridden = true;
    const { screen, input, prevCard, relearn, at } = last;
    const { item } = screen;
    const ws = { wordId: screen.word.id, knownMarked: false, queuedNext: false, tooEasy: false, ...this.wordStates.get(screen.word.id) };
    ws.accepted = [...(ws.accepted || []), input.trim()];
    this.putWord(ws);
    const report = { wordId: ws.wordId, ts: this.now(), kind: 'override', answer: input.trim(), note: '' };
    this.persist(() => this.store.addReport(report));

    let rated = null;
    if (item.kind === 'review') {
      if (relearn) this.learning = this.learning.filter((i) => i !== relearn);
      rated = Grade.Good;
      this.saveCard({ ...rate(prevCard, Grade.Good, at, this.settings.retention), step: null });
    } else if (item.kind === 'relearn') {
      this.learning = this.learning.filter((i) => i !== item);
      this.saveCard({ ...prevCard, step: null });
    } else if (screen.step === 'tooEasy') {
      rated = this.passTooEasy(item, at);
    } else if (last.result.outcome !== 'almost') {
      // He was right after all: the miss doesn't count.
      if (!prevCard.missed) {
        const { missed, ...card } = this.cards.get(item.cardId);
        this.saveCard(card);
      }
      item.step = item.after;
      item.after = null;
      rated = this.passTyping(item, at);
    }
    const row = { ...last.logRow, outcome: 'override', grade: rated ?? last.logRow.grade };
    this.persist(async () => this.store.updateLog(await last.logKey, row));
    return { accepted: input.trim(), rated };
  }
}
