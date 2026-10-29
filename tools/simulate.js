// 90-day simulation of a learner (PLAN §8.1): runs the real session engine (session.js, srs.js,
// grading.js) day by day and prints reviews, minutes and retention per week.
//   node tools/simulate.js [--days 90] [--new 10] [--skip 0.14] [--seed 1] [--retention 0.9] [--penalty 0.04]
// --penalty: how much worse than FSRS's prediction the learner recalls (0 = exactly as predicted).
process.env.TZ ||= 'Europe/Amsterdam';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Session, WORD_FILES } from '../session.js';
import { retrievability, secondsPerCard, DEFAULT_SECONDS, dayKey } from '../srs.js';
import { displayForm } from '../grading.js';
import { DEFAULT_SETTINGS } from '../db.js';

// Small seeded random generator, so a run can be repeated.
export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The learner: recall follows FSRS's own prediction, made a little worse (real learners are
// noisier than the model); typos now and then; time per card from typical typing speed.
const LEARNER = {
  tooEasy: 0.05, tooEasyRight: 0.7, mcRight: 0.95, learnRight: 0.85, typo: 0.06, relearnRight: 0.9,
  penalty: 0.04,
  ms: { intro: 15000, mc: 6000, type: 10000, correct: 9000, almost: 14000, wrong: 20000 },
};

const typo = (s) => (s.length > 5 ? s.slice(0, -2) + s.at(-1) + s.at(-2) : `${s}x`);

export async function simulate({ days = 90, newPerDay = 10, skip = 1 / 7, seed = 1, retention = 0.9, penalty = LEARNER.penalty, words } = {}) {
  const random = rng(seed);
  const store = { cards: new Map(), words: new Map(), log: [] };
  const memory = {
    putCard: (c) => { store.cards.set(c.id, c); },
    putWord: (w) => { store.words.set(w.wordId, w); },
    addLog: (r) => store.log.push(r) - 1,
    updateLog: (k, r) => { store.log[k] = r; },
    addReport: () => {},
  };
  const settings = { ...DEFAULT_SETTINGS, newPerDay, retention };
  const start = new Date(2026, 10, 2, 19, 0);
  const out = [];
  for (let d = 0; d < days; d++) {
    const t0 = new Date(start.getFullYear(), start.getMonth(), start.getDate() + d, 19, 0);
    if (random() < skip) {
      out.push({ day: d + 1, skipped: true });
      continue;
    }
    let clock = t0.getTime();
    const now = () => new Date(clock);
    const s = new Session({
      words, wordStates: [...store.words.values()], cards: [...store.cards.values()], settings,
      seconds: secondsPerCard(store.log.slice(-3000)), store: memory, now, random,
    });
    const stat = { day: d + 1, skipped: false, reviews: 0, correct: 0, lapses: 0, newWords: 0, ms: 0, paused: s.paused, dueAtStart: s.reviews.length };
    for (let guard = 0; guard < 5000; guard++) {
      const sc = s.next();
      if (!sc) break;
      const word = sc.word;
      let ms;
      if (sc.step === 'intro') {
        const easy = random() < LEARNER.tooEasy;
        ms = LEARNER.ms.intro;
        s.answerIntro(sc, easy ? 'tooEasy' : 'continue', ms);
      } else if (sc.step === 'mc') {
        ms = LEARNER.ms.mc;
        s.answerChoice(sc, random() < LEARNER.mcRight ? sc.correct : (sc.correct + 1) % 4, ms);
      } else {
        let p;
        if (sc.step === 'review') p = Math.max(0, retrievability(sc.card, now(), retention) - penalty);
        else if (sc.step === 'relearn') p = LEARNER.relearnRight;
        else if (sc.step === 'tooEasy') p = LEARNER.tooEasyRight;
        else p = LEARNER.learnRight;
        const right = random() < p;
        const slip = right && random() < LEARNER.typo;
        const answer = !right ? 'xyzzy' : slip ? typo(displayForm(word)) : displayForm(word);
        ms = !right ? LEARNER.ms.wrong : slip ? LEARNER.ms.almost : LEARNER.ms.correct;
        if (sc.step !== 'review') ms = Math.min(ms, LEARNER.ms.type + (right && !slip ? 0 : 8000));
        const r = s.answerTyped(sc, answer, ms);
        if (sc.step === 'review') {
          stat.reviews++;
          if (r.outcome === 'correct' || r.outcome === 'almost') stat.correct++;
          else stat.lapses++;
        }
      }
      stat.ms += ms;
      clock += ms;
    }
    await s.flush();
    stat.newWords = s.stats.newWords;
    out.push(stat);
  }
  const learned = [...store.cards.values()].filter((c) => c.step == null).length;
  const endDay = new Date(start.getFullYear(), start.getMonth(), start.getDate() + days, 19);
  const backlog = [...store.cards.values()].filter((c) => c.step == null && dayKey(c.fsrs.due) <= dayKey(endDay)).length;
  return { days: out, learned, backlog };
}

export function report(result, { words: wordCount, retention = 0.9, penalty = LEARNER.penalty }) {
  const lines = [];
  const pad = (v, n) => String(v).padStart(n);
  lines.push('week  days  new/day  reviews/day  minutes/day  max min  retention');
  for (let w = 0; w * 7 < result.days.length; w++) {
    const week = result.days.slice(w * 7, w * 7 + 7);
    const done = week.filter((d) => !d.skipped);
    const avg = (f) => (done.length ? done.reduce((s, d) => s + f(d), 0) / done.length : 0);
    const reviews = done.reduce((s, d) => s + d.reviews, 0);
    const correct = done.reduce((s, d) => s + d.correct, 0);
    lines.push(`${pad(w + 1, 4)}  ${pad(done.length, 4)}  ${pad(avg((d) => d.newWords).toFixed(1), 7)}  ${pad(avg((d) => d.reviews).toFixed(0), 11)}  ${pad(avg((d) => d.ms / 60000).toFixed(0), 11)}  ${pad(Math.max(0, ...done.map((d) => d.ms / 60000)).toFixed(0), 7)}  ${reviews ? `${(100 * correct / reviews).toFixed(0)}%` : '-'}`);
  }
  const all = result.days.filter((d) => !d.skipped);
  const reviews = all.reduce((s, d) => s + d.reviews, 0);
  const correct = all.reduce((s, d) => s + d.correct, 0);
  const paused = all.filter((d) => d.paused).length;
  lines.push('');
  lines.push(`studied ${all.length} of ${result.days.length} days · ${result.learned} words learned (of ${wordCount}) · overall review retention ${(100 * correct / reviews).toFixed(1)}%`);
  lines.push(`days with new words paused (reviews > 30 min): ${paused} · reviews due on the day after the run: ${result.backlog}`);
  const odd = [];
  const last = all.slice(-14);
  const lateMin = last.reduce((s, d) => s + d.ms, 0) / Math.max(1, last.length) / 60000;
  if (lateMin > 40) odd.push(`last two weeks average ${lateMin.toFixed(0)} min a day (more than 40)`);
  const r = correct / reviews;
  // The learner recalls `penalty` below FSRS's prediction, so retention should land about there.
  if (r < retention - penalty - 0.04 || r > retention + 0.03) odd.push(`retention ${(100 * r).toFixed(1)}% is far from the ${100 * retention}% target`);
  if (paused) odd.push(`new words paused on ${paused} days`);
  lines.push(odd.length ? `look at: ${odd.join('; ')}` : 'nothing odd');
  return lines.join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = (name, def) => {
    const i = process.argv.indexOf(`--${name}`);
    return i > 0 ? Number(process.argv[i + 1]) : def;
  };
  const root = new URL('..', import.meta.url);
  const real = WORD_FILES.flatMap((f) => JSON.parse(readFileSync(new URL(f, root), 'utf8')));
  const days = arg('days', 90);
  const newPerDay = arg('new', 10);
  // Enough words for the whole run: the real ones first, then stand-ins for the bands to come.
  const words = [...real];
  for (let i = 1; words.filter((w) => !w.clozeOnly).length < days * newPerDay * 1.2; i++) {
    words.push({ id: 100000 + i, rank: 10000 + i, pos: 'adj', de: `wort${i}`, nl: [`woord${i}`], acceptAlso: [], groups: [], showInitial: false });
  }
  const result = await simulate({ days, newPerDay, skip: arg('skip', 1 / 7), seed: arg('seed', 1), retention: arg('retention', 0.9), penalty: arg('penalty', LEARNER.penalty), words });
  console.log(`Simulation: ${days} days, ${newPerDay} new words a day, about 1 day in 7 skipped, desired retention ${arg('retention', 0.9)}, learner ${arg('penalty', LEARNER.penalty)} below FSRS's prediction`);
  console.log(`(seconds per card defaults: ${JSON.stringify(DEFAULT_SECONDS)})\n`);
  console.log(report(result, { words: words.length, retention: arg('retention', 0.9), penalty: arg('penalty', LEARNER.penalty) }));
}
