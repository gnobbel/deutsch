import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  openDb, migrate, clearProgress, toJSONWithDates, parseJSONWithDates, MIGRATIONS, SCHEMA_VERSION, DEFAULT_SETTINGS,
} from '../../db.js';
import { Session, planToday } from '../../session.js';
import { DEFAULT_SECONDS } from '../../srs.js';
import { displayForm } from '../../grading.js';

let n = 0;
const freshName = () => `test-${++n}`;

// Realistic-looking data, including dates nested the way FSRS stores them.
async function fill(db) {
  const due = new Date('2026-11-02T03:00:00Z');
  await db.put('cards', {
    id: '214:production', wordId: 214, type: 'production', suspended: false, step: 0, leech: false,
    fsrs: { due, stability: 3.2, difficulty: 5.1, state: 2, reps: 4, lapses: 0, last_review: new Date('2026-10-30T08:12:00Z') },
  });
  await db.put('cards', {
    id: '215:production', wordId: 215, type: 'production', suspended: true, step: 1, leech: false,
    fsrs: { due: new Date('2026-10-29T03:00:00Z'), stability: 0.5, difficulty: 7, state: 1, reps: 1, lapses: 0, last_review: null },
  });
  await db.put('reviewLog', { cardId: '214:production', ts: new Date('2026-10-30T08:12:00Z'), grade: 3, answer: 'das Handy', ms: 4200, practice: false });
  await db.put('reviewLog', { cardId: '215:production', ts: new Date('2026-10-30T08:13:00Z'), grade: 1, answer: 'der Stahl', ms: 9100, practice: false });
  await db.put('words', { wordId: 214, introducedOn: new Date('2026-10-28T09:00:00Z'), tooEasy: false, knownMarked: false, queuedNext: false, accepted: ['Mobiltelefon'] });
  await db.put('reports', { wordId: 214, ts: new Date('2026-10-30T08:14:00Z'), kind: 'override', answer: 'Mobiltelefon', note: '' });
  await db.setSetting('newPerDay', 7);
  await db.setMeta('copyListChoice', '7d');
}

function assertHasDates(dump) {
  assert.ok(dump.cards[0].fsrs.due instanceof Date, 'fsrs.due is a Date');
  assert.ok(dump.cards[0].fsrs.last_review instanceof Date, 'fsrs.last_review is a Date');
  assert.ok(dump.reviewLog[0].ts instanceof Date, 'reviewLog.ts is a Date');
  assert.ok(dump.words[0].introducedOn instanceof Date, 'introducedOn is a Date');
}

test('new database starts at the current schema with default settings', async () => {
  const db = await openDb({ name: freshName() });
  assert.equal(await db.getMeta('schemaVersion'), SCHEMA_VERSION);
  assert.deepEqual(await db.getSettings(), DEFAULT_SETTINGS);
  db.close();
});

test('backup → reset → restore gives identical data, with dates as dates', async () => {
  const db = await openDb({ name: freshName() });
  await fill(db);
  const now = new Date(2026, 9, 30, 12);
  const { filename, text } = await db.exportBackup({ appVersion: '0.1.0', now });
  assert.equal(filename, 'deutsch-backup-2026-10-30.json');
  assert.equal(await db.getMeta('lastBackup'), undefined, 'not marked until the file is saved');
  await db.markBackedUp(now);
  const before = await db.dump();
  assertHasDates(before);

  await db.resetAll();
  const empty = await db.dump();
  assert.equal(empty.cards.length, 0);
  assert.equal(empty.reviewLog.length, 0);
  assert.equal((await db.getSettings()).newPerDay, DEFAULT_SETTINGS.newPerDay);

  const parsed = db.parseBackup(text);
  assert.deepEqual(parsed.summary, { exportedAt: new Date(2026, 9, 30, 12), words: 1, cards: 2, reviews: 2 });
  await db.restoreBackup(parsed);
  const after = await db.dump();
  assertHasDates(after);
  assert.deepEqual(after, before);
  db.close();
});

test('the backup file stores dates as tagged text and reads them back as dates', () => {
  const v = { a: new Date('2026-01-02T03:04:05.000Z'), b: [{ c: new Date('2026-05-06T00:00:00.000Z') }], d: 'x' };
  const text = toJSONWithDates(v);
  assert.match(text, /"\$date": "2026-01-02T03:04:05.000Z"/);
  assert.deepEqual(parseJSONWithDates(text), v);
});

test('importing rejects files that are not a usable backup', async () => {
  const db = await openDb({ name: freshName() });
  assert.throws(() => db.parseBackup('not json'), /geen geldig/);
  assert.throws(() => db.parseBackup('{"app":"other","data":{}}'), /geen backup van deze app/);
  assert.throws(() => db.parseBackup(JSON.stringify({ app: 'deutsch', schemaVersion: SCHEMA_VERSION + 1, data: {} })), /nieuwere versie/);
  assert.throws(() => db.parseBackup(JSON.stringify({ app: 'deutsch', schemaVersion: 1, data: { cards: 'x' } })), /beschadigd/);
  db.close();
});

test('snapshots: one before each import and reset, only the last 3 kept', async () => {
  const db = await openDb({ name: freshName() });
  await fill(db);
  const { text } = await db.exportBackup();
  for (let i = 0; i < 4; i++) await db.restoreBackup(db.parseBackup(text));
  await db.resetAll();
  const snaps = await db.listSnapshots();
  assert.equal(snaps.length, 3);
  assert.equal(snaps.at(-1).reason, 'voor alles wissen');
  assert.equal(snaps.at(-1).data.cards.length, 2, 'snapshot holds the data from before the reset');
  db.close();
});

// A pretend schema 2 that renames a field, to exercise the machinery end to end.
const testMigrations = [{
  to: 2,
  up: (d) => ({ ...d, words: d.words.map(({ queuedNext, ...w }) => ({ ...w, queued: queuedNext })) }),
}];

test('opening an older database migrates it, after taking a snapshot', async () => {
  const name = freshName();
  const v1 = await openDb({ name });
  await fill(v1);
  v1.close();

  const v2 = await openDb({ name, schemaVersion: 2, migrations: testMigrations });
  assert.equal(await v2.getMeta('schemaVersion'), 2);
  const w = (await v2.getAll('words'))[0];
  assert.equal(w.queued, false);
  assert.ok(!('queuedNext' in w));
  assert.ok(w.introducedOn instanceof Date);
  const snaps = await v2.listSnapshots();
  assert.equal(snaps.length, 1);
  assert.equal(snaps[0].schemaVersion, 1);
  assert.ok('queuedNext' in snaps[0].data.words[0], 'snapshot keeps the old shape');
  // Opening again does not migrate twice.
  v2.close();
  const again = await openDb({ name, schemaVersion: 2, migrations: testMigrations });
  assert.equal((await again.listSnapshots()).length, 1);
  again.close();
});

test('importing an older backup migrates it to the current schema', async () => {
  const v1 = await openDb({ name: freshName() });
  await fill(v1);
  const { text } = await v1.exportBackup();
  v1.close();

  const v2 = await openDb({ name: freshName(), schemaVersion: 2, migrations: testMigrations });
  const parsed = v2.parseBackup(text);
  await v2.restoreBackup(parsed);
  assert.equal(await v2.getMeta('schemaVersion'), 2);
  assert.equal((await v2.getAll('words'))[0].queued, false);
  v2.close();
});

test('a pre-launch reset migration clears progress but keeps settings', () => {
  const dump = { cards: [{ id: 'x' }], reviewLog: [{}], words: [{}], reports: [{}], settings: [{ key: 'newPerDay', value: 5 }], meta: [] };
  const out = migrate(dump, 1, [{ to: 2, up: clearProgress }], 2);
  assert.deepEqual(out.cards, []);
  assert.deepEqual(out.reviewLog, []);
  assert.deepEqual(out.settings, dump.settings);
});

test('a missing migration step is an error, not silent data loss', () => {
  assert.throws(() => migrate({}, 1, [], 2), /Geen migratie naar schema 2/);
});

test('MIGRATIONS covers every schema version up to the current one', () => {
  for (let v = 2; v <= SCHEMA_VERSION; v++) assert.ok(MIGRATIONS.find((m) => m.to === v), `migration to ${v}`);
});

test('a damaged backup is refused before anything is touched', async () => {
  const db = await openDb({ name: freshName() });
  await fill(db);
  const before = await db.dump();
  const bad = (data) => JSON.stringify({ app: 'deutsch', schemaVersion: 1, data });
  assert.throws(() => db.parseBackup(bad({ meta: [{ value: 1 }] })), /beschadigd/);
  assert.throws(() => db.parseBackup(bad({ cards: [{ wordId: 1 }] })), /beschadigd/);
  assert.throws(() => db.parseBackup(bad({ words: ['x'] })), /beschadigd/);
  // A backup that leaves out stores is fine; they count as empty.
  assert.equal(db.parseBackup(bad({ settings: [] })).summary.words, 0);
  assert.deepEqual(await db.dump(), before);
  db.close();
});

test('if writing fails half-way, nothing is lost (all or nothing)', async () => {
  const db = await openDb({ name: freshName() });
  await fill(db);
  const before = await db.dump();
  // An object is not a valid key: the row check lets it through, put() throws mid-transaction.
  const bad = { ...before, cards: [{ id: {}, wordId: 1 }, ...before.cards] };
  await assert.rejects(() => db.replaceAll(bad));
  assert.deepEqual(await db.dump(), before);
  db.close();
});

// The store the app gives the session (same calls as app.js).
const dbStore = (db) => ({
  putCard: (c) => db.put('cards', c),
  putWord: (w) => db.put('words', w),
  addLog: (r) => db.put('reviewLog', r),
  updateLog: (k, r) => db.put('reviewLog', { ...r, id: k }),
  addReport: (r) => db.put('reports', r),
});

test('backup → reset → restore with real FSRS cards: dates stay dates, the same cards are due', async () => {
  const db = await openDb({ name: freshName() });
  const words = Array.from({ length: 20 }, (_, i) => ({
    id: i + 1, rank: i + 1, pos: 'adj', de: `wort${i + 1}`, nl: [`woord${i + 1}`], acceptAlso: [], groups: [], showInitial: false,
  }));
  const settings = await db.getSettings();
  // Day 1: learn 5 words; day 6: review them, one lapse; day 7: start a word and stop halfway.
  for (const [day, newPerDay, stopAfter] of [[1, 5, Infinity], [6, 0, Infinity], [7, 1, 2]]) {
    let t = new Date(2026, 9, day, 10).getTime();
    const s = new Session({
      words, wordStates: await db.getAll('words'), cards: await db.getAll('cards'), settings: { ...settings, newPerDay },
      seconds: DEFAULT_SECONDS, store: dbStore(db), now: () => new Date((t += 5000)),
    });
    for (let n = 0; n < stopAfter; n++) {
      const sc = s.next();
      if (!sc) break;
      if (sc.step === 'intro') s.answerIntro(sc, 'continue', 3000);
      else if (sc.step === 'mc') s.answerChoice(sc, sc.correct, 2000);
      else s.answerTyped(sc, sc.word.id === 2 && sc.step === 'review' ? 'falsch' : displayForm(sc.word), 4000);
    }
    await s.flush();
  }
  const before = await db.dump();
  assert.ok(before.cards.some((c) => c.fsrs.lapses >= 1), 'has a lapsed card');
  assert.ok(before.cards.some((c) => c.step !== null), 'has an unfinished word');
  assert.ok(before.reviewLog.length > 20);
  const dueBefore = planToday({ words, wordStates: new Map(before.words.map((w) => [w.wordId, w])), cards: new Map(before.cards.map((c) => [c.id, c])),
    settings, seconds: DEFAULT_SECONDS, now: new Date(2026, 9, 30, 10) });

  const { text } = await db.exportBackup();
  await db.resetAll();
  await db.restoreBackup(db.parseBackup(text));
  const after = await db.dump();
  for (const store of ['cards', 'reviewLog', 'words', 'reports', 'settings']) assert.deepEqual(after[store], before[store], store);
  for (const c of after.cards.filter((x) => x.step === null)) {
    assert.ok(c.fsrs.due instanceof Date && c.fsrs.last_review instanceof Date, c.id);
  }
  assert.ok(after.reviewLog.every((r) => r.ts instanceof Date));
  const dueAfter = planToday({ words, wordStates: new Map(after.words.map((w) => [w.wordId, w])), cards: new Map(after.cards.map((c) => [c.id, c])),
    settings, seconds: DEFAULT_SECONDS, now: new Date(2026, 9, 30, 10) });
  assert.ok(dueBefore.reviews.length > 0);
  assert.deepEqual(dueAfter.reviews.map((c) => c.id), dueBefore.reviews.map((c) => c.id));
  assert.deepEqual(dueAfter.learning.map((c) => c.id), dueBefore.learning.map((c) => c.id));
  db.close();
});
