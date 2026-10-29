// FSRS wrapper and the scheduling rules around it (PLAN §5, §8).
process.env.TZ = 'Europe/Amsterdam';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  Grade, State, newCard, rate, dayKey, nextDayStart, isDue, applySiblingsRule, newWordsPaused,
  secondsPerCard, estimateMinutes, DEFAULT_SECONDS, LEECH_LAPSES,
} from '../../srs.js';

const at = (s) => new Date(s);

test('the learning day runs from 04:00 to 04:00 local time', () => {
  assert.equal(dayKey(at('2026-10-29T03:59:00+01:00')), '2026-10-28');
  assert.equal(dayKey(at('2026-10-29T04:00:00+01:00')), '2026-10-29');
  assert.equal(dayKey(at('2026-10-29T23:30:00+01:00')), '2026-10-29');
  assert.equal(nextDayStart(at('2026-10-29T02:00:00+01:00')).toISOString(), '2026-10-29T03:00:00.000Z');
  // Across the switch to winter time (25 October 2026).
  assert.equal(dayKey(at('2026-10-25T03:30:00+01:00')), '2026-10-24');
  assert.equal(dayKey(at('2026-10-25T04:10:00+01:00')), '2026-10-25');
});

test('no short-term steps: the first rating schedules whole days', () => {
  const now = at('2026-10-29T10:00:00+01:00');
  const c = newCard(7, 'production', now);
  assert.equal(c.fsrs.state, State.New);
  for (const g of [Grade.Again, Grade.Hard, Grade.Good, Grade.Easy]) {
    const r = rate(c, g, now);
    assert.equal(r.fsrs.state, State.Review, `grade ${g}`);
    assert.ok(r.fsrs.scheduled_days >= 1, `grade ${g}`);
  }
  assert.ok(rate(c, Grade.Easy, now).fsrs.scheduled_days > rate(c, Grade.Good, now).fsrs.scheduled_days);
  assert.equal(c.fsrs.state, State.New, 'rate() leaves its input untouched');
});

test('a lapse counts, and 6 lapses make a leech', () => {
  let c = rate(newCard(7, 'production', at('2026-01-01T10:00:00Z')), Grade.Good, at('2026-01-01T10:00:00Z'));
  for (let i = 0; i < LEECH_LAPSES; i++) {
    assert.equal(c.leech, false);
    c = rate(c, Grade.Again, c.fsrs.due);
  }
  assert.equal(c.fsrs.lapses, LEECH_LAPSES);
  assert.equal(c.leech, true);
});

test('a card is due from the start of its due day, and not while it is in a learning step', () => {
  const card = { ...newCard(7, 'production', at('2026-10-29T10:00:00+01:00')), step: null };
  const reviewed = { ...rate(card, Grade.Good, at('2026-10-29T10:00:00+01:00')), step: null };
  const dueDay = reviewed.fsrs.due;
  const morning = new Date(dueDay.getFullYear(), dueDay.getMonth(), dueDay.getDate(), 4, 30);
  assert.equal(isDue(reviewed, morning), true);
  assert.equal(isDue(reviewed, new Date(morning.getTime() - 2 * 3600e3)), false);
  assert.equal(isDue({ ...reviewed, step: 'relearn' }, morning), false);
  assert.equal(isDue({ ...reviewed, suspended: true }, morning), false);
  assert.equal(isDue(card, morning), false, 'a new card is never a review');
});

test('siblings rule: one card per word per day', () => {
  const now = at('2026-10-29T10:00:00+01:00');
  const c = (wordId, type, last) => ({ id: `${wordId}:${type}`, wordId, type, fsrs: { last_review: last } });
  const doneToday = c(1, 'production', at('2026-10-29T09:00:00+01:00'));
  const due = [c(1, 'recognition', at('2026-10-20T09:00:00+01:00')), c(2, 'production', null), c(2, 'recognition', null)];
  assert.deepEqual(applySiblingsRule(due, [doneToday, ...due], now).map((x) => x.id), ['2:production']);
});

test('reviews first: new words pause above ~30 minutes of due reviews', () => {
  const cards = (n) => Array.from({ length: n }, (_, i) => ({ id: `${i}:production`, type: 'production' }));
  assert.equal(newWordsPaused(cards(150), DEFAULT_SECONDS), false); // 30 min exactly
  assert.equal(newWordsPaused(cards(151), DEFAULT_SECONDS), true);
});

test('minutes estimate: defaults first, then median seconds from the review log', () => {
  assert.equal(estimateMinutes([{ type: 'production' }, { type: 'production' }], 3, DEFAULT_SECONDS), 4); // 24 s + 180 s
  const log = [];
  for (let i = 0; i < 5; i++) log.push({ cardId: `${i}:production`, step: 'review', ms: 6000 });
  for (let i = 0; i < 5; i++) for (const step of ['intro', 'mc', 'type1', 'type2']) log.push({ cardId: `${10 + i}:production`, step, ms: 5000 });
  log.push({ cardId: '1:production', step: 'review', ms: 900000, practice: true });
  const s = secondsPerCard(log);
  assert.equal(s.production, 6);
  assert.equal(s.newWord, 20);
  assert.equal(s.cloze, DEFAULT_SECONDS.cloze);
});
