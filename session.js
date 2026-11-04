// Session flow (PLAN §6, §8.2): which card comes next, the learning steps of new words, lapses
// and relearning. Pure logic: the screens come from cards.js, persistence goes through `store`.
// session.js decides only *when within a session* a card comes back; srs.js (FSRS) decides its
// schedule, with one rating at graduation, at Te makkelijk, or at a review answer.
import { grade, gradeToRating, displayForm, normalize, buildIndex, retryHint } from './grading.js';
import {
  Grade, State, CARD_TYPES, newCard, rate, isDue, dayKey, retrievability, applySiblingsRule, newWordsPaused,
} from './srs.js';

// Every word file, in rank order (all of them are precached by sw.js).
export const WORD_FILES = ['words/words-0001-0500.json', 'words/words-0501-1000.json', 'words/words-1001-1500.json', 'words/words-1501-2000.json'];

// Herhalen: how many other cards come before a lapsed word's relearning step (§6.3). Leren: how
// many other cards at least come between "Ken ik al" and its typed check (§6.2).
export const GAP = { relearn: 5, check: 3 };
// Learning steps stored on a card (§6.2): 'intro' = new, not asked yet (its first question is a
// multiple choice); 'mc' = multiple choice; 'type1' = typed; 'tooEasy' = the typed check after
// "Ken ik al". Test data from before v0.8.0 may hold 'type2': it counts as 'type1'.
export const LEARN_STEPS = ['intro', 'mc', 'type1', 'type2', 'tooEasy'];
// Leren works in rounds, like Quizlet's Learn: up to ROUND_SIZE words, each asked once per round.
export const ROUND_SIZE = 7;
// Toets: up to this many learned words of the chosen level.
export const TEST_SIZE = 20;

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
// The level Leren takes new words from: the chosen one, unless it was marked too easy since
// (then the normal order again, §6.1).
export const chosenLevel = (settings) => {
  const l = settings?.learnLevel ?? null;
  return l != null && !easySet(settings).has(l) ? l : null;
};

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
// - `level`: only words of this level (the level chosen on Home), except words queued first.
export function pickNewWord(words, wordStates, cards, now, easy = new Set(), level = null) {
  const reach = level == null ? null : levelReach(words, wordStates, easy, level);
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
  return words.find((w) => free(w) && wordStates.get(w.id)?.queuedNext)
    || words.find((w) => free(w) && (reach == null || reach.has(w.id))) || null;
}

// The words a chosen level can bring: its own new words, plus the base words they wait for
// (Großvater in level 5 needs Vater from level 1 first, §6.1 word families), however far back.
export function levelReach(words, wordStates, easy, level) {
  const byId = new Map(words.map((w) => [w.id, w]));
  const reach = new Set();
  const todo = words.filter((w) => levelOf(w) === level && isNewCandidate(w, wordStates.get(w.id), easy)).map((w) => w.id);
  while (todo.length) {
    const id = todo.pop();
    if (reach.has(id)) continue;
    reach.add(id);
    const b = byId.get(id).base;
    if (b != null && byId.has(b) && !wordStates.get(b)?.introducedOn) todo.push(b);
  }
  return reach;
}

// How many new words a session could really introduce now, picking them one by one with every
// rule (confusable sets, hard-word cap, word families, the chosen level), up to `max`. Home's
// "Vandaag nog n nieuwe woorden" and the session use the same number.
function newWordsInReach(words, wordStates, cards, now, easy, level, max) {
  const ws = new Map(wordStates);
  const cs = new Map(cards);
  let n = 0;
  while (n < max) {
    const w = pickNewWord(words, ws, cs, now, easy, level);
    if (!w) break;
    ws.set(w.id, { ...ws.get(w.id), wordId: w.id, introducedOn: now, tooEasy: false, queuedNext: false });
    cs.set(`${w.id}:production`, newCard(w.id, 'production', now));
    n++;
  }
  return n;
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
  // With a level chosen on Home, new words come from that level (plus words queued first and the
  // base words they need); every rule is applied, so the number is what Leren can really give.
  const level = chosenLevel(settings);
  const sorted = [...words].sort((a, b) => a.rank - b.rank);
  const newToday = paused ? 0 : newWordsInReach(sorted, wordStates, cards, now, easy, level, Math.max(0, Math.min(settings.newPerDay - usedToday, left)));
  // The scan adds reviews later, so it pauses together with new words.
  const toScan = scanLeft(words, wordStates, easy);
  const scanToday = paused ? 0 : Math.max(0, Math.min(SCANS_PER_DAY - scannedToday(wordStates, now), toScan));
  const relearn = learning.filter((c) => c.step === 'relearn');
  const learnNow = learning.filter((c) => c.step !== 'relearn');
  return { reviews, learning, relearn, learnNow, paused, newToday, newLeft: left, usedToday, scanToday, scanLeft: toScan };
}

// How far a level is (Home, the level list, a round's summary): `known` = its production card is in
// review (gekend), `learning` = still in its learning steps (bezig), `fresh` = not started (nieuw).
// Words of a level marked too easy that weren't scanned yet count as fresh.
export function levelProgress(words, cards, level) {
  const out = { level, total: 0, known: 0, learning: 0, fresh: 0 };
  for (const w of words) {
    if (w.clozeOnly || levelOf(w) !== level) continue;
    out.total++;
    const c = cards.get(`${w.id}:production`);
    // A lapsed word waiting for its relearning step stays gekend.
    if (c && (c.step == null || c.step === 'relearn') && c.fsrs.state !== State.New) out.known++;
    else if (c && LEARN_STEPS.includes(c.step)) out.learning++;
    else out.fresh++;
  }
  return out;
}

// The learned words of a level, for Toets: production cards in review, not suspended.
export function testCards(words, cards, level) {
  const ids = new Set(words.filter((w) => !w.clozeOnly && levelOf(w) === level).map((w) => w.id));
  return [...cards.values()].filter((c) => c.type === 'production' && ids.has(c.wordId) && !c.suspended
    && c.step == null && c.fsrs.state !== State.New);
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

// ---------- the sessions (§6.2–§6.4, §8.2) ----------

const shuffled = (xs, random) => {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

// mode: 'review' (Herhalen: due reviews and relearning steps), 'learn' (Leren: rounds of new and
// unfinished words from the chosen level), 'test' (Toets: learned words of a level, scored).
// store: { putCard(card), putWord(wordState), addLog(row) → key, updateLog(key, row), addReport(row) },
// each returning a promise. The session itself is synchronous, so the UI can show the next card
// inside the same tap (iOS only opens the keyboard then); every write is queued at once, in
// order, and `flush()` waits for them. A failed write goes to `onError`.
export class Session {
  constructor({ words, wordStates, cards, settings, seconds, store, mode = 'review', level = null, now = () => new Date(), random = Math.random, onError = () => {} }) {
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
    this.mode = mode;
    this.pending = Promise.resolve();
    this.easy = easySet(settings);
    this.shown = 0;
    this.current = null;
    this.last = null;
    this.stats = { done: 0, ms: 0, newWords: 0, reviews: 0, correct: 0 };
    const plan = planToday({ words: this.words, wordStates: this.wordStates, cards: this.cards, settings, seconds, now: now() });
    this.paused = plan.paused;
    this.queue = [];
    this.learning = [];
    if (mode === 'review') {
      this.queue = plan.reviews.map((c) => ({ kind: 'review', cardId: c.id, step: 'review' }));
      this.learning = plan.relearn.map((c) => ({ kind: 'relearn', cardId: c.id, step: 'relearn', readyAt: 0 }));
    } else if (mode === 'learn') {
      this.level = chosenLevel(settings);
      this.newRemaining = plan.newToday;
      this.deferred = 0;
      // Unfinished words continue first (from any level).
      this.active = plan.learnNow.map((c) => ({ kind: 'learn', cardId: c.id, step: c.step === 'type2' ? 'type1' : c.step, after: null, done: false }));
      this.roundNo = 0;
      this.round = [];
      this.roundResults = [];
      this.startRound();
    } else {
      this.level = level ?? settings.learnLevel ?? currentLevel(this.words, this.wordStates, settings.easyLevels || []) ?? 1;
      this.queue = shuffled(testCards(this.words, this.cards, this.level), random).slice(0, TEST_SIZE)
        .map((c) => ({ kind: 'test', cardId: c.id, step: 'test' }));
      this.results = [];
    }
    this.total = this.queue.length + this.learning.length;
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

  // Count-based progress for the bar: within the round on Leren, over the whole session otherwise.
  progress() {
    if (this.mode === 'learn') return this.roundSize ? (this.roundSize - this.round.length - (this.current ? 1 : 0)) / this.roundSize : 1;
    const left = this.queue.length + this.learning.length + (this.current ? 1 : 0);
    return this.shown / Math.max(1, this.shown + left);
  }

  // ---------- Leren: rounds (§6.2) ----------

  // A new round: words that became "gekend" leave, new words of the chosen level fill up to
  // ROUND_SIZE (within today's limit), and the order is shuffled (never the same word twice in a row).
  // A "Ken ik al" check goes at the end of the round, and only when at least GAP.check other cards
  // came since "Ken ik al"; otherwise it waits (for a later round, or the next session): typed
  // straight after seeing the word it tests short-term memory (§6.2).
  startRound() {
    this.active = this.active.filter((i) => !i.done);
    while (this.active.length < ROUND_SIZE && this.newRemaining > 0) {
      const item = this.introduceNext();
      if (!item) break;
      this.active.push(item);
    }
    const others = shuffled(this.active.filter((i) => i.step !== 'tooEasy'), this.random);
    if (others.length > 1 && others[0] === this.lastItem) others.push(others.shift());
    const checks = [];
    // Oldest "Ken ik al" first, so the most recent ones get the most cards in between.
    for (const i of this.active.filter((x) => x.step === 'tooEasy').sort((a, b) => (a.askedAt ?? -1) - (b.askedAt ?? -1))) {
      if (i.askedAt == null || this.shown - i.askedAt + others.length + checks.length >= GAP.check) checks.push(i);
    }
    this.round = [...others, ...checks];
    this.deferred = this.active.length - this.round.length;
    this.roundNo++;
    this.roundSize = this.round.length;
    this.roundResults = [];
    this.summaryShown = false;
  }

  // Called by the round summary's "Volgende ronde".
  nextRound() {
    this.startRound();
  }

  // The round summary, once a round's words have all been asked.
  roundSummary() {
    // More to do: a word still to learn that isn't a check waiting for other cards, or new words.
    const left = this.active.filter((i) => !i.done && !(i.step === 'tooEasy' && i.askedAt != null && this.shown - i.askedAt < GAP.check));
    return {
      step: 'round', round: this.roundNo, results: this.roundResults,
      more: left.length > 0 || this.newRemaining > 0,
    };
  }

  // Picks a new word for the round. It is kept in memory only (so the next pick sees it) and
  // stored at its first answer: stopping halfway leaves the words not answered yet untouched.
  introduceNext() {
    const now = this.now();
    const w = pickNewWord(this.words, this.wordStates, this.cards, now, this.easy, this.level);
    if (!w) return null;
    this.newRemaining--;
    const ws = { knownMarked: false, queuedNext: false, accepted: [], ...this.wordStates.get(w.id), wordId: w.id, introducedOn: now, tooEasy: false };
    ws.queuedNext = false;
    const card = newCard(w.id, 'production', now);
    this.wordStates.set(ws.wordId, ws);
    this.cards.set(card.id, card);
    return { kind: 'learn', cardId: card.id, step: 'intro', after: null, done: false, unsaved: true };
  }

  // Stores a picked new word at its first answer (introducedOn = that moment).
  firstAnswer(item) {
    if (!item.unsaved) return;
    item.unsaved = false;
    const now = this.now();
    const card = this.cards.get(item.cardId);
    this.putWord({ ...this.wordStates.get(card.wordId), introducedOn: now });
    this.saveCard({ ...card, fsrs: { ...card.fsrs, due: now } });
    this.stats.newWords++;
  }

  // ---------- the next screen ----------

  // The next screen; on Leren a { step: 'round' } summary after each round; null when done.
  next() {
    if (this.current) return this.current;
    let item;
    if (this.mode === 'learn') {
      if (!this.round.length) {
        if (!this.roundResults.length || this.summaryShown) return null;
        this.summaryShown = true;
        return this.roundSummary();
      }
      item = this.round.shift();
    } else {
      item = this.pickItem();
    }
    if (!item) return null;
    this.lastItem = item;
    const card = this.cards.get(item.cardId);
    const word = this.wordsById.get(card.wordId);
    const screen = { item, step: item.step, card, word, hint: null };
    if (item.step === 'intro' || item.step === 'mc') Object.assign(screen, mcOptions(word, this.words, this.random));
    if (word.showInitial && ['type1', 'tooEasy', 'review', 'relearn', 'test'].includes(item.step)) screen.hint = word.de[0];
    this.current = screen;
    return screen;
  }

  // Herhalen and Toets: a relearning step that is ready, then the queue, then waiting steps.
  pickItem() {
    const ready = this.learning.filter((i) => i.readyAt <= this.shown).sort((a, b) => a.readyAt - b.readyAt);
    if (ready.length) return ready[0];
    if (this.queue.length) return this.queue.shift();
    if (this.learning.length) return [...this.learning].sort((a, b) => a.readyAt - b.readyAt)[0];
    return null;
  }

  // "Dit niveau lijkt te makkelijk" (§6.1), for the level of the word just answered. A word whose
  // Te makkelijk check hasn't come yet doesn't count.
  levelLooksEasy(level) {
    // (Also words picked for the round but not answered yet.)
    const pending = new Set((this.active || []).filter((i) => !i.done && (i.step === 'tooEasy' || i.unsaved)).map((i) => this.cards.get(i.cardId).wordId));
    return levelLooksEasy(level, this.words, this.wordStates, [...this.easy], pending);
  }

  // Skips the rest of a level from now on: its words no longer come as new words in this session
  // either; if it was the chosen level, new words follow the normal order again. Returns the
  // settings to store.
  skipLevel(level) {
    this.easy.add(level);
    const easyLevels = [...this.easy].sort((a, b) => a - b);
    if (this.level === level) this.level = null;
    this.settings = { ...this.settings, easyLevels, learnLevel: this.level ?? null };
    return { easyLevels, learnLevel: this.level ?? null };
  }

  saveCard(card) {
    this.cards.set(card.id, card);
    this.persist(() => this.store.putCard(card));
  }

  putWord(ws) {
    this.wordStates.set(ws.wordId, ws);
    this.persist(() => this.store.putWord(ws));
  }

  setStep(item, step) {
    item.step = step;
    this.saveCard({ ...this.cards.get(item.cardId), step });
  }

  graduate(item, rating, now) {
    item.done = true;
    const { missed, ...card } = this.cards.get(item.cardId);
    this.saveCard({ ...rate(card, rating, now, this.settings.retention), step: null });
    return rating;
  }

  // A miss while learning (a multiple choice after the word was shown, a typed step, or the
  // Te makkelijk check) is stored on the card, so it survives the end of a session; the word then
  // becomes "gekend" with Hard instead of Good (§8.1).
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
    if (screen.step === 'review') this.stats.reviews++;
  }

  // "Ken ik al" on a new word's first question: it is asked typed in the next round (the
  // Te makkelijk check, §6.2).
  answerIntro(screen, action, ms = 0) {
    this.firstAnswer(screen.item);
    this.log(screen, ms, { outcome: action });
    this.resolved(screen, ms);
    if (action === 'tooEasy') {
      this.setStep(screen.item, 'tooEasy');
      screen.item.askedAt = this.shown;
      this.roundResults.push({ wordId: screen.word.id, ok: true, step: 'intro', known: true });
    }
    return { action };
  }

  // Multiple choice. choice: the option's index, or -1 for "Weet ik niet". Right → typed next
  // round; wrong → the word is shown, and it is a multiple choice again next round. A miss on a
  // new word's very first question is a first look, not a miss.
  answerChoice(screen, choice, ms = 0) {
    this.firstAnswer(screen.item);
    const correct = choice === screen.correct;
    this.log(screen, ms, { answer: choice >= 0 ? screen.options[choice] : null, outcome: correct ? 'correct' : choice < 0 ? 'dontKnow' : 'wrong' });
    this.resolved(screen, ms);
    const { item } = screen;
    if (!correct && screen.step !== 'intro') this.markMissed(item);
    if (correct) {
      const step = item.after || 'type1';
      item.after = null;
      this.setStep(item, step);
    } else {
      this.setStep(item, 'mc');
    }
    this.roundResults.push({ wordId: screen.word.id, ok: correct, step: screen.step });
    return { correct, correctIndex: screen.correct, showWord: !correct };
  }

  // A typed answer (Leren's typed step or Te makkelijk check, a review, a relearning step, Toets).
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
      this.log(screen, ms, { answer: input, outcome: 'different', reason: result.reason });
      // The start of the word helps, except for a context set: there the sentence is the help (§4.2).
      if (!screen.word.contextSet) screen.hint = retryHint(screen.word, input);
      screen.retried = true;
      return { ...result, rated: null };
    }
    const passed = result.outcome === 'correct' || result.outcome === 'almost';
    const prevCard = this.cards.get(item.cardId);
    let rated = null;
    let relearn = null;
    this.resolved(screen, ms);
    if (passed) this.stats.correct++;

    if (item.kind === 'review') {
      rated = gradeToRating(result.outcome);
      let card = rate(prevCard, rated, now, this.settings.retention);
      if (rated === Grade.Again) {
        // Lapse: rated Again once, now; one relearning typing step later (not rated).
        relearn = { kind: 'relearn', cardId: card.id, step: 'relearn', readyAt: this.shown + GAP.relearn };
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
    } else if (item.kind === 'test') {
      // A Toets answer is a review for FSRS, which takes a review at any moment; at most one
      // rating per word per day (siblings rule), so a word already reviewed today is practice.
      const ratedToday = prevCard.fsrs.last_review && dayKey(prevCard.fsrs.last_review) === dayKey(now);
      if (!ratedToday) {
        rated = gradeToRating(result.outcome);
        this.saveCard(rate(prevCard, rated, now, this.settings.retention));
      }
      this.results.push({ wordId: screen.word.id, ok: passed, answer: input });
    } else if (item.step === 'tooEasy') {
      if (result.outcome === 'correct') rated = this.passTooEasy(item, now);
      else {
        this.markMissed(item);
        this.setStep(item, 'mc');
      }
      this.roundResults.push({ wordId: screen.word.id, ok: result.outcome === 'correct', step: 'tooEasy', graduated: rated != null });
    } else {
      if (passed) rated = this.passTyping(item, now);
      else {
        // A miss in the typed step: multiple choice next round, then typed again.
        this.markMissed(item);
        item.after = item.step;
        this.setStep(item, 'mc');
      }
      this.roundResults.push({ wordId: screen.word.id, ok: passed, step: item.step, graduated: rated != null });
    }
    // `reason` (article, umlaut, plural, form) is what §2 needs to decide on a gender drill.
    const { key, row } = this.log(screen, ms, { answer: input, outcome: result.outcome, grade: rated, reason: result.reason });
    this.last = { screen, input, result, prevCard, relearn, rated, logKey: key, logRow: row, at: now };
    return { ...result, rated, graduated: rated != null && item.kind === 'learn' };
  }

  // A word that went wrong somewhere while learning starts with Hard: FSRS sets a card's
  // difficulty and first interval from its first rating, and Anki feeds it every learning-step
  // answer, so a miss there counts. Here one rating stands for all of them (§8.1).
  passTyping(item, now) {
    return this.graduate(item, this.cards.get(item.cardId).missed ? Grade.Hard : Grade.Good, now);
  }

  passTooEasy(item, now) {
    const ws = this.wordStates.get(this.cards.get(item.cardId).wordId);
    // Te makkelijk doesn't count toward the daily limit: a word counted today gives its place back
    // (a check left over from an earlier day never took one today).
    if (countsTowardLimit(ws, now)) this.newRemaining++;
    this.putWord({ ...ws, tooEasy: true });
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
    const passedBefore = last.result.outcome === 'almost';
    if (!passedBefore) this.stats.correct++;

    let rated = null;
    if (item.kind === 'review') {
      if (relearn) this.learning = this.learning.filter((i) => i !== relearn);
      rated = Grade.Good;
      this.saveCard({ ...rate(prevCard, Grade.Good, at, this.settings.retention), step: null });
    } else if (item.kind === 'relearn') {
      this.learning = this.learning.filter((i) => i !== item);
      this.saveCard({ ...prevCard, step: null });
    } else if (item.kind === 'test') {
      if (last.rated != null) {
        rated = Grade.Good;
        this.saveCard(rate(prevCard, Grade.Good, at, this.settings.retention));
      }
      this.results.at(-1).ok = true;
    } else if (screen.step === 'tooEasy') {
      rated = this.passTooEasy(item, at);
      Object.assign(this.roundResults.at(-1), { ok: true, graduated: true });
    } else if (!passedBefore) {
      // He was right after all: the miss doesn't count.
      if (!prevCard.missed) {
        const { missed, ...card } = this.cards.get(item.cardId);
        this.saveCard(card);
      }
      item.step = item.after;
      item.after = null;
      rated = this.passTyping(item, at);
      Object.assign(this.roundResults.at(-1), { ok: true, graduated: true });
    }
    const row = { ...last.logRow, outcome: 'override', grade: rated ?? last.logRow.grade };
    this.persist(async () => this.store.updateLog(await last.logKey, row));
    return { accepted: input.trim(), rated };
  }
}
