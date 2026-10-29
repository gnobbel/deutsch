// Session flow (PLAN §6, §8.2): which card comes next, the learning steps of new words, lapses
// and relearning. Pure logic: the screens come from cards.js, persistence goes through `store`.
// session.js decides only *when within a session* a card comes back; srs.js (FSRS) decides its
// schedule, with one rating at graduation, at Te makkelijk, or at a review answer.
import { grade, gradeToRating, displayForm, normalize, buildIndex } from './grading.js';
import {
  Grade, CARD_TYPES, newCard, rate, isDue, dayKey, retrievability, applySiblingsRule, newWordsPaused,
} from './srs.js';

// Every word file, in rank order (all of them are precached by sw.js).
export const WORD_FILES = ['words/words-0001-0500.json'];

export const REVIEWS_PER_NEW = 4;
// How many other cards must come in between (§6.2).
export const GAP = { type1: 3, type2: 8, mcAgain: 3, typeMiss: 2, relearn: 5 };
export const LEARN_STEPS = ['intro', 'mc', 'type1', 'type2', 'tooEasy'];
const STEPS_LEFT = { intro: 4, tooEasy: 4, mc: 3, type1: 2, type2: 1, relearn: 1 };

// ---------- choosing new words (§6.1) ----------

// A word counts toward today's limit when it was introduced today, unless it passed Te makkelijk.
export function countsTowardLimit(ws, now) {
  return !!ws?.introducedOn && dayKey(ws.introducedOn) === dayKey(now) && !ws.tooEasy;
}

export const isNewCandidate = (w, ws) => !w.clozeOnly && !ws?.introducedOn;

export function newWordsLeft(words, wordStates) {
  return words.filter((w) => isNewCandidate(w, wordStates.get(w.id))).length;
}

// Confusable-set rule: a word that shares a `groups` label with a word introduced today or still
// in learning waits (it keeps its place). Words queued with "Leer dit als volgende" go first.
export function pickNewWord(words, wordStates, cards, now) {
  const today = dayKey(now);
  const busy = new Set();
  for (const c of cards.values()) if (LEARN_STEPS.includes(c.step)) busy.add(c.wordId);
  for (const ws of wordStates.values()) if (ws.introducedOn && dayKey(ws.introducedOn) === today) busy.add(ws.wordId);
  const blocked = new Set();
  for (const w of words) if (busy.has(w.id)) for (const g of w.groups) blocked.add(g);
  const free = (w) => isNewCandidate(w, wordStates.get(w.id)) && !w.groups.some((g) => blocked.has(g));
  return words.find((w) => free(w) && wordStates.get(w.id)?.queuedNext) || words.find(free) || null;
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
  const usedToday = [...wordStates.values()].filter((ws) => countsTowardLimit(ws, now)).length;
  const left = newWordsLeft(words, wordStates);
  const newToday = paused ? 0 : Math.max(0, Math.min(settings.newPerDay - usedToday, left));
  return { reviews, learning, paused, newToday, newLeft: left, usedToday };
}

// ---------- multiple choice (§6.2 step 2) ----------

// Four German options: same part of speech and similar rank; nouns with their article, and one
// distractor is the same noun with a wrong article. Never another valid answer for the prompt.
export function mcOptions(word, words, random = Math.random) {
  const right = displayForm(word);
  const prompt = normalize(word.nl[0]);
  const valid = new Set([right, ...(word.acceptAlso || [])].map((s) => normalize(s)));
  const usable = (w) => w.id !== word.id && !w.clozeOnly && w.de !== word.de && !w.nl.some((n) => normalize(n) === prompt)
    && !valid.has(normalize(displayForm(w)));
  const pick = (pool, n) => {
    const out = [];
    const p = [...pool];
    while (out.length < n && p.length) out.push(p.splice(Math.floor(random() * p.length), 1)[0]);
    return out;
  };
  const distractors = [];
  if (word.pos === 'noun') {
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
    const wantNew = this.newRemaining > 0 && (this.reviews.length === 0 || this.reviewsSinceNew >= REVIEWS_PER_NEW);
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
    const w = pickNewWord(this.words, this.wordStates, this.cards, now);
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
    this.saveCard({ ...rate(this.cards.get(item.cardId), rating, now, this.settings.retention), step: null });
    return rating;
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
    this.setStep(screen.item, action === 'tooEasy' ? 'tooEasy' : 'mc', this.shown);
    return { action };
  }

  // Multiple choice. A miss shows the intro again; the multiple choice comes back later.
  answerChoice(screen, choice, ms = 0) {
    const correct = choice === screen.correct;
    this.log(screen, ms, { answer: screen.options[choice], outcome: correct ? 'correct' : 'wrong' });
    this.resolved(screen, ms);
    const { item } = screen;
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
      screen.hint = screen.word.de[0];
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
      else this.setStep(item, 'mc', this.shown);
    } else if (passed) {
      rated = this.passTyping(item, now);
    } else {
      // A miss in a typing step: multiple choice once more, then the same typing step again.
      item.after = item.step;
      this.setStep(item, 'mc', this.shown + GAP.typeMiss);
    }
    const { key, row } = this.log(screen, ms, { answer: input, outcome: result.outcome, grade: rated });
    this.last = { screen, input, result, prevCard, relearn, logKey: key, logRow: row, at: now };
    return { ...result, rated, graduated: rated != null && item.kind === 'learn' };
  }

  passTyping(item, now) {
    if (item.step === 'type1') {
      this.setStep(item, 'type2', this.shown + GAP.type2);
      return null;
    }
    return this.graduate(item, Grade.Good, now);
  }

  passTooEasy(item, now) {
    this.putWord({ ...this.wordStates.get(this.cards.get(item.cardId).wordId), tooEasy: true });
    this.newRemaining++; // Te makkelijk doesn't count toward the daily limit.
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
      item.step = item.after;
      item.after = null;
      rated = this.passTyping(item, at);
    }
    const row = { ...last.logRow, outcome: 'override', grade: rated ?? last.logRow.grade };
    this.persist(async () => this.store.updateLog(await last.logKey, row));
    return { accepted: input.trim(), rated };
  }
}
