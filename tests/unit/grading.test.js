// PLAN §7.6: every listed example, plus the "Ik had gelijk" safeguards (§7.5).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { grade, gradePlural, gradeVerbForms, buildIndex, normalize, editDistance, diffParts } from '../../grading.js';

const W = (o) => ({ acceptAlso: [], groups: [], nlArticle: null, ...o });
const words = [
  W({ id: 1, pos: 'noun', de: 'Handy', article: 'das', plural: 'Handys', nl: ['mobiel'] }),
  W({ id: 2, pos: 'noun', de: 'Hand', article: 'die', plural: 'Hände', nl: ['hand'] }),
  W({ id: 3, pos: 'noun', de: 'Stuhl', article: 'der', plural: 'Stühle', nl: ['stoel'] }),
  W({ id: 4, pos: 'noun', de: 'Stahl', article: 'der', plural: null, nl: ['staal'] }),
  W({ id: 5, pos: 'noun', de: 'Eis', article: 'das', plural: null, nl: ['ijs'] }),
  W({ id: 6, pos: 'adj', de: 'schön', nl: ['mooi'], acceptAlso: ['hübsch'] }),
  W({ id: 7, pos: 'adv', de: 'schon', nl: ['al'] }),
  W({ id: 8, pos: 'verb', de: 'bekommen', nl: ['krijgen'], acceptAlso: ['kriegen', 'erhalten'], strong: true,
    forms: { pres3: 'bekommt', praet: 'bekam', part: 'bekommen', aux: 'haben' } }),
  W({ id: 9, pos: 'verb', de: 'freuen', reflexive: true, governs: 'über/auf + Akk.', nl: ['zich verheugen'] }),
  W({ id: 10, pos: 'noun', de: 'Straße', article: 'die', plural: 'Straßen', nl: ['straat'] }),
  W({ id: 11, pos: 'adj', de: 'müde', nl: ['moe'] }),
  W({ id: 12, pos: 'noun', de: 'Wasser', article: 'das', plural: null, nl: ['water'] }),
  W({ id: 13, pos: 'conj', de: 'dass', nl: ['dat'] }),
  W({ id: 14, pos: 'adj', de: 'teuer', nl: ['duur'] }),
  W({ id: 15, pos: 'adj', de: 'aktuell', nl: ['actueel'] }),
  W({ id: 16, pos: 'verb', de: 'essen', nl: ['eten'], strong: true, forms: { pres3: 'isst', praet: 'aß', part: 'gegessen', aux: 'haben' } }),
  W({ id: 17, pos: 'verb', de: 'fahren', nl: ['rijden'], strong: true, forms: { pres3: 'fährt', praet: 'fuhr', part: 'gefahren', aux: 'sein' } }),
  W({ id: 18, pos: 'adj', de: 'hübsch', nl: ['mooi', 'knap'] }),
  W({ id: 19, pos: 'phrase', de: 'eine Entscheidung treffen', nl: ['een beslissing nemen'] }),
  W({ id: 21, pos: 'verb', de: 'warten', governs: 'auf + Akk.', nl: ['wachten'] }),
  W({ id: 22, pos: 'verb', de: 'gehören', governs: 'Dat. / zu', nl: ['horen bij'] }),
  W({ id: 20, pos: 'verb', de: 'anfangen', separable: 'an', nl: ['beginnen'], strong: true,
    forms: { pres3: 'fängt an', praet: 'fing an', part: 'angefangen', aux: 'haben' } }),
];
const byDe = Object.fromEntries(words.map((w) => [w.de, w]));
const index = buildIndex(words);
const g = (input, de, opts = {}) => grade(input, byDe[de], { index, ...opts });
const outcome = (input, de, opts) => g(input, de, opts).outcome;

test('normalisation: trim, spaces, NFC, apostrophes, capitals', () => {
  assert.equal(normalize('  Das   HANDY '), 'das handy');
  assert.equal(normalize('Müde'), 'müde');
  assert.equal(normalize('geht’s'), "geht's");
  assert.equal(normalize('Das Handy', { ignoreCase: false }), 'Das Handy');
});

test('correct answers (§7.6)', () => {
  assert.equal(outcome('das handy', 'Handy'), 'correct');
  assert.equal(outcome('freuen', 'freuen'), 'correct');
  assert.equal(outcome('sich freuen', 'freuen'), 'correct');
  assert.equal(outcome('anfangen', 'anfangen'), 'correct');
  assert.equal(outcome('eine Entscheidung treffen', 'eine Entscheidung treffen'), 'correct');
});

test('verbs with a preposition: only the verb is required, the preposition may be added (§7.3)', () => {
  assert.equal(outcome('warten', 'warten'), 'correct');
  assert.equal(outcome('warten auf', 'warten'), 'correct');
  assert.equal(outcome('freuen über', 'freuen'), 'correct');
  assert.equal(outcome('sich freuen auf', 'freuen'), 'correct');
  assert.equal(outcome('gehören zu', 'gehören'), 'correct');
  assert.equal(outcome('warten für', 'warten'), 'wrong');
});

test('umlaut shortcuts count, with a note showing the proper spelling', () => {
  assert.deepEqual([outcome('Muede', 'müde'), g('Muede', 'müde').note], ['correct', 'müde']);
  assert.deepEqual([outcome('die Strasse', 'Straße'), g('die Strasse', 'Straße').note], ['correct', 'die Straße']);
  assert.equal(outcome('die Strasse', 'Straße', { umlautShortcuts: false }), 'wrong');
});

test('genuine ss / ue in the target are not disturbed by the shortcut', () => {
  for (const [input, de] of [['das Wasser', 'Wasser'], ['dass', 'dass'], ['teuer', 'teuer'], ['aktuell', 'aktuell'], ['essen', 'essen']]) {
    const r = g(input, de);
    assert.equal(r.outcome, 'correct', input);
    assert.equal(r.note, null, input);
  }
});

test('umlaut/ß errors are wrong, never a typo', () => {
  assert.equal(outcome('Schon', 'schön'), 'wrong');
  assert.equal(g('Schon', 'schön').reason, 'umlaut');
  assert.equal(outcome('die Strase', 'Straße'), 'wrong');
});

test('almost: one typo in a word of 4+ letters', () => {
  assert.equal(outcome('das Hnady', 'Handy'), 'almost');
  assert.equal(outcome('das Hndy', 'Handy'), 'almost');
  assert.equal(outcome('eine Entscheidung trefen', 'eine Entscheidung treffen'), 'almost');
  assert.equal(outcome('eine Entschiedung trefen', 'eine Entscheidung treffen'), 'wrong');
});

test('a real German word is wrong, even one letter away', () => {
  assert.equal(outcome('das Hand', 'Handy'), 'wrongReal');
  assert.equal(outcome('der Stahl', 'Stuhl'), 'wrongReal');
  assert.equal(outcome('die Handys', 'Handy'), 'wrongReal');
});

test('too short for typo tolerance', () => {
  assert.equal(outcome('das Ei', 'Eis'), 'wrong');
});

test('the article is part of the word', () => {
  assert.equal(outcome('der Handy', 'Handy'), 'wrong');
  assert.equal(outcome('Handy', 'Handy'), 'wrong');
  assert.equal(g('der Handy', 'Handy').reason, 'article');
  assert.equal(g('des Handy', 'Handy').outcome, 'wrong');
});

test('a different valid word: acceptAlso or another word with the same Dutch prompt', () => {
  assert.equal(outcome('hübsch', 'schön'), 'different');
  assert.equal(outcome('kriegen', 'bekommen'), 'different');
  assert.equal(outcome('Kriegen', 'bekommen'), 'different');
});

test('answers accepted through "Ik had gelijk" count as correct for that word only', () => {
  assert.equal(outcome('das Mobiltelefon', 'Handy', { accepted: ['das Mobiltelefon'] }), 'correct');
  assert.equal(outcome('das Mobiltelefon', 'Handy'), 'wrong');
});

test('ignore capitalisation can be switched off', () => {
  assert.equal(outcome('das handy', 'Handy', { ignoreCase: false }), 'almost');
  assert.equal(outcome('das Handy', 'Handy', { ignoreCase: false }), 'correct');
});

test('"Ik had gelijk" is not offered for umlaut/ß or article errors (§7.5)', () => {
  assert.equal(g('Schon', 'schön').canOverride, false);
  assert.equal(g('der Handy', 'Handy').canOverride, false);
  assert.equal(g('Handy', 'Handy').canOverride, false);
  assert.equal(g('die Strase', 'Straße').canOverride, false);
  assert.equal(g('das Hnady', 'Handy').canOverride, true);
  assert.equal(g('das Mobiltelefon', 'Handy').canOverride, true);
  assert.equal(g('', 'Handy').canOverride, false);
});

test('plural card: with or without "die"; umlauts matter', () => {
  assert.equal(gradePlural('Stühle', byDe.Stuhl).outcome, 'correct');
  assert.equal(gradePlural('die Stühle', byDe.Stuhl).outcome, 'correct');
  assert.equal(gradePlural('Stuhle', byDe.Stuhl).outcome, 'wrong');
  assert.equal(gradePlural('die Stuehle', byDe.Stuhl).outcome, 'correct');
});

test('verb forms card: fields checked separately, present with or without er/sie/es', () => {
  const ok = gradeVerbForms({ pres3: 'faehrt', part: 'gefahren', aux: 'sein' }, byDe.fahren);
  assert.equal(ok.fields.pres3.outcome, 'correct');
  assert.equal(ok.fields.pres3.note, 'fährt');
  assert.equal(ok.rating, 3);
  assert.equal(gradeVerbForms({ pres3: 'er fährt', part: 'gefahren', aux: 'ist' }, byDe.fahren).rating, 3);
  const typo = gradeVerbForms({ pres3: 'fährt', part: 'gefaren', aux: 'sein' }, byDe.fahren);
  assert.equal(typo.fields.part.outcome, 'almost');
  assert.equal(typo.rating, 2);
  assert.equal(gradeVerbForms({ pres3: 'fahrt', part: 'gefahren', aux: 'sein' }, byDe.fahren).rating, 1);
  assert.equal(gradeVerbForms({ pres3: 'fährt', part: 'gefahren', aux: 'haben' }, byDe.fahren).rating, 1);
});

test('edit distance counts a swap as one edit', () => {
  assert.equal(editDistance('hnady', 'handy'), 1);
  assert.equal(editDistance('hndy', 'handy'), 1);
  assert.equal(editDistance('abc', 'xyz'), 3);
});

test('diffParts marks the differing letters of the target', () => {
  assert.deepEqual(diffParts('das Hndy', 'das Handy'), ['das H', 'a', 'ndy']);
});
