// FSRS wrapper (PLAN §8.1). The library owns all card state and intervals; its own short-term
// (learning/relearning) steps are off, because session.js runs those steps itself.
import { fsrs, generatorParameters, createEmptyCard, State } from './vendor/ts-fsrs.js';

export const Grade = { Again: 1, Hard: 2, Good: 3, Easy: 4 };
export { State };

const schedulers = new Map();
function scheduler(retention) {
  if (!schedulers.has(retention)) {
    schedulers.set(retention, fsrs(generatorParameters({
      request_retention: retention, enable_short_term: false, enable_fuzz: true,
    })));
  }
  return schedulers.get(retention);
}

export const LEECH_LAPSES = 6;
// Card types in review order (§8.2).
export const CARD_TYPES = ['production', 'recognition', 'cloze', 'plural', 'verbforms'];

// A new card record for the `cards` store (§12.1). `fsrs` stays a fresh, unrated card until
// the word graduates; `step` is the learning step the session is at (null = in review).
// `last_review` starts as null rather than the library's undefined, which a JSON backup would drop
// (the library treats both the same).
export function newCard(wordId, type, now) {
  return {
    id: `${wordId}:${type}`, wordId, type, fsrs: { ...createEmptyCard(now), last_review: null }, suspended: false, step: 'intro', leech: false,
  };
}

// Rates a card once. Returns the updated record (the input is left untouched).
export function rate(card, grade, now, retention = 0.9) {
  const next = scheduler(retention).next(card.fsrs, now, grade).card;
  return { ...card, fsrs: next, leech: card.leech || next.lapses >= LEECH_LAPSES };
}

export function retrievability(card, now, retention = 0.9) {
  if (card.fsrs.state === State.New) return 0;
  return scheduler(retention).get_retrievability(card.fsrs, now, false);
}

// ---------- the 04:00 day boundary ----------

export const DAY_START_HOUR = 4;

// The learning day a moment belongs to, as 'YYYY-MM-DD' (local time; a day runs 04:00–04:00).
export function dayKey(date) {
  const d = new Date(date);
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  if (d.getHours() < DAY_START_HOUR) day.setDate(day.getDate() - 1);
  const pad = (n) => String(n).padStart(2, '0');
  return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
}

// The moment the next learning day starts.
export function nextDayStart(now) {
  const [y, m, d] = dayKey(now).split('-').map(Number);
  return new Date(y, m - 1, d + 1, DAY_START_HOUR);
}

// A review card is due when its due date falls on today's learning day or earlier.
export function isDue(card, now) {
  return !card.suspended && card.step == null && card.fsrs.state !== State.New && dayKey(card.fsrs.due) <= dayKey(now);
}

// ---------- the extra rules (§5, §8.2), each in one named function ----------

// Siblings rule: at most one card per word per day. A due card is held back when another card of
// its word was already reviewed today, or when an earlier card in the list is of the same word.
export function applySiblingsRule(dueCards, allCards, now) {
  const today = dayKey(now);
  const seen = new Set(allCards.filter((c) => c.fsrs.last_review && dayKey(c.fsrs.last_review) === today).map((c) => c.wordId));
  return dueCards.filter((c) => {
    if (seen.has(c.wordId)) return false;
    seen.add(c.wordId);
    return true;
  });
}

export const OVERDUE_PAUSE_MINUTES = 30;

// Reviews first: new words pause while more than ~30 minutes of reviews are due.
export function newWordsPaused(dueCards, seconds) {
  const total = dueCards.reduce((sum, c) => sum + (seconds[c.type] ?? seconds.production), 0);
  return total > OVERDUE_PAUSE_MINUTES * 60;
}

// ---------- time estimates (§8.2) ----------

export const DEFAULT_SECONDS = { production: 12, recognition: 6, cloze: 15, plural: 8, verbforms: 20, newWord: 60 };
const MIN_SAMPLES = 5;
const LEARNING_STEPS = new Set(['intro', 'mc', 'type1', 'type2', 'tooEasy']);

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

// Median seconds per card type from the review log, and per new word (all its learning steps
// together). Defaults until there are enough answers.
export function secondsPerCard(log) {
  const out = { ...DEFAULT_SECONDS };
  const byType = {};
  const perNewCard = {};
  for (const r of log) {
    if (r.practice || !(r.ms > 0)) continue;
    const type = String(r.cardId).split(':')[1];
    if (LEARNING_STEPS.has(r.step)) perNewCard[r.cardId] = (perNewCard[r.cardId] || 0) + r.ms;
    else if (r.step === 'review') (byType[type] ||= []).push(r.ms);
  }
  for (const [type, xs] of Object.entries(byType)) if (xs.length >= MIN_SAMPLES) out[type] = median(xs) / 1000;
  const news = Object.values(perNewCard);
  if (news.length >= MIN_SAMPLES) out.newWord = median(news) / 1000;
  return out;
}

export function estimateMinutes(dueCards, newCount, seconds) {
  const s = dueCards.reduce((sum, c) => sum + (seconds[c.type] ?? seconds.production), 0) + newCount * seconds.newWord;
  return Math.ceil(s / 60);
}
