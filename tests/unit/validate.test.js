import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWords, levelForRank } from '../../tools/validate.js';

const handy = () => ({
  id: 214, rank: 214, level: 'A1', pos: 'noun',
  de: 'Handy', article: 'das', plural: 'Handys',
  nl: ['mobiele telefoon', 'mobieltje', 'gsm'], nlArticle: 'de',
  example: { de: 'Mein [[Handy]] ist schon wieder kaputt.', nl: 'Mijn mobieltje is alweer kapot.' },
  acceptAlso: [], showInitial: false, falseFriend: null, cognate: true, groups: [], check: false,
});
const anfangen = () => ({
  id: 90, rank: 90, level: 'A1', pos: 'verb', de: 'anfangen',
  nl: ['beginnen'], nlArticle: null,
  example: { de: 'Ich [[fange]] morgen [[an]].', nl: 'Ik begin morgen.' },
  acceptAlso: ['beginnen'], showInitial: false, falseFriend: null, cognate: false, groups: [], check: false,
  strong: true, forms: { pres3: 'fängt an', praet: 'fing an', part: 'angefangen', aux: 'haben' },
  separable: 'an', reflexive: false, governs: null,
});

const errs = (entries, opts) => validateWords(entries, opts).join('\n');

test('the PLAN example entries are valid', () => {
  assert.deepEqual(validateWords([handy(), anfangen()]), []);
});

test('noun without article or plural is rejected', () => {
  const w = handy();
  delete w.article;
  delete w.plural;
  assert.match(errs([w]), /needs article/);
  assert.match(errs([w]), /needs plural/);
});

test('wrong number of markers is rejected', () => {
  const w = handy();
  w.example.de = 'Mein Handy ist kaputt.';
  assert.match(errs([w]), /0 \[\[ \]\] markers/);
  const v = anfangen();
  v.example.de = 'Ich [[fange]] [[morgen]] [[an]].';
  assert.match(errs([v]), /3 \[\[ \]\] markers/);
});

test('strong verb without forms is rejected', () => {
  const v = anfangen();
  delete v.forms;
  assert.match(errs([v]), /strong verb needs forms/);
});

test('duplicate ids and duplicate meanings are rejected', () => {
  assert.match(errs([handy(), handy()]), /duplicate id/);
  const b = handy();
  b.id = 999; b.rank = 215;
  assert.match(errs([handy(), b]), /duplicate \(de, pos, meaning\)/);
});

test('one entry per meaning is allowed (Bank = bank / bench)', () => {
  const a = { ...handy(), id: 300, rank: 300, de: 'Bank', article: 'die', plural: 'Banken', nl: ['bank'], nlArticle: 'de', example: { de: 'Die [[Bank]] ist zu.', nl: 'De bank is dicht.' } };
  const b = { ...a, id: 301, rank: 301, plural: 'Bänke', nl: ['bankje'], nlArticle: 'het', example: { de: 'Wir sitzen auf der [[Bank]].', nl: 'We zitten op het bankje.' } };
  assert.deepEqual(validateWords([a, b]), []);
});

test('unknown groups are rejected; opposites are allowed', () => {
  const w = handy();
  w.groups = ['food'];
  assert.match(errs([w]), /unknown group food/);
  w.groups = ['opp:links-rechts', 'colors'];
  assert.deepEqual(validateWords([w]), []);
});

test('false friends must not be marked cognate', () => {
  const w = { ...handy(), falseFriend: { nl: 'mist', note: 'Duits Mist = mest/rommel' }, cognate: true };
  assert.match(errs([w]), /cognate: false/);
});

test('rank must fit the file and the level must match the band', () => {
  assert.match(errs([handy()], { range: [501, 1000] }), /rank outside 501–1000/);
  const w = handy();
  w.level = 'B1';
  assert.match(errs([w]), /level should be A1/);
  assert.equal(levelForRank(501), 'A2');
});

test('reflexive verbs are written without sich', () => {
  const v = { ...anfangen(), de: 'sich freuen', separable: null, strong: false, forms: undefined, reflexive: true, example: { de: 'Ich [[freue]] mich.', nl: 'Ik ben blij.' } };
  delete v.forms;
  assert.match(errs([v]), /without "sich"/);
});

test('noun alternatives must include their article', () => {
  const w = { ...handy(), acceptAlso: ['Mobiltelefon'] };
  assert.match(errs([w]), /acceptAlso "Mobiltelefon" needs its article/);
  w.acceptAlso = ['das Mobiltelefon'];
  assert.deepEqual(validateWords([w]), []);
});

test('the same word in two band files is caught', () => {
  const seenIds = new Set();
  const seenKeys = new Set();
  assert.deepEqual(validateWords([handy()], { seenIds, seenKeys }), []);
  const again = { ...handy(), id: 600, rank: 600, level: 'A2' };
  assert.match(validateWords([again], { seenIds, seenKeys }).join(), /duplicate \(de, pos, meaning\)/);
});
