import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkWord, parseCsvLine } from '../../tools/crosscheck.js';

const wikt = new Map([
  ['Bank', [
    { articles: new Set(['die']), plurals: new Set(['Bänke']), hasSingular: true },
    { articles: new Set(['die']), plurals: new Set(['Banken']), hasSingular: true },
  ]],
  ['See', [
    { articles: new Set(['der']), plurals: new Set(['Seen']), hasSingular: true },
    { articles: new Set(['die']), plurals: new Set(['Seen']), hasSingular: true },
  ]],
  ['Eltern', [{ articles: new Set(), plurals: new Set(['Eltern']), hasSingular: false }]],
]);
const verbs = {
  fahren: { PA2: ['gefahren'], 'PRÄ': { S: { 3: 'fährt' } }, PRT: { S: { 3: 'fuhr' } } },
  müssen: { PA2: ['gemußt'], 'PRÄ': { S: { 3: 'muß' } }, PRT: { S: { 3: 'mußte' } } },
  anfangen: { PA2: ['angefangen'], 'PRÄ': { S: { 3: ['fängt', 'an'] } }, PRT: { S: { 3: ['fing', 'an'] } } },
  machen: { PA2: ['gemacht'], 'PRÄ': { S: { 3: 'macht' } }, PRT: { S: { 3: 'machte' } } },
};
const S = { wikt, morphyNouns: {}, verbs };
const fields = (w) => checkWord(w, S).map((i) => i.field);

test('both meanings of a noun are accepted, but article and plural must belong together', () => {
  assert.deepEqual(fields({ id: 1, de: 'Bank', pos: 'noun', article: 'die', plural: 'Bänke' }), []);
  assert.deepEqual(fields({ id: 1, de: 'Bank', pos: 'noun', article: 'die', plural: 'Banken' }), []);
  assert.deepEqual(fields({ id: 1, de: 'Bank', pos: 'noun', article: 'das', plural: 'Bänke' }), ['article']);
  assert.deepEqual(fields({ id: 1, de: 'See', pos: 'noun', article: 'die', plural: 'Seen' }), []);
  assert.deepEqual(fields({ id: 1, de: 'Bank', pos: 'noun', article: 'die', plural: 'Banke' }), ['plural']);
});

test('plural-only nouns and unknown words', () => {
  assert.deepEqual(fields({ id: 2, de: 'Eltern', pos: 'noun', article: 'die', plural: null, pluralOnly: true }), []);
  assert.deepEqual(fields({ id: 3, de: 'Quatschwort', pos: 'noun', article: 'das', plural: null }), ['noun']);
});

test('verb forms are compared, old ß spelling is flagged for a look', () => {
  assert.deepEqual(fields({ id: 4, de: 'fahren', pos: 'verb', strong: true, separable: null, forms: { pres3: 'fährt', praet: 'fuhr', part: 'gefahren', aux: 'sein' } }), []);
  assert.deepEqual(fields({ id: 4, de: 'anfangen', pos: 'verb', strong: true, separable: 'an', forms: { pres3: 'fängt an', praet: 'fing an', part: 'angefangen', aux: 'haben' } }), []);
  const m = checkWord({ id: 5, de: 'müssen', pos: 'verb', strong: true, separable: null, forms: { pres3: 'muss', praet: 'musste', part: 'gemusst', aux: 'haben' } }, S);
  assert.deepEqual(m.map((i) => i.note), ['Morphy (old spelling?)', 'Morphy (old spelling?)', 'Morphy (old spelling?)']);
  assert.deepEqual(fields({ id: 4, de: 'fahren', pos: 'verb', strong: true, separable: null, forms: { pres3: 'fahrt', praet: 'fuhr', part: 'gefahren', aux: 'sein' } }), ['forms.pres3']);
});

test('a verb marked weak that the dictionary conjugates irregularly is flagged', () => {
  assert.deepEqual(fields({ id: 6, de: 'machen', pos: 'verb', strong: false, separable: null }), []);
  assert.deepEqual(fields({ id: 7, de: 'fahren', pos: 'verb', strong: false, separable: null }), ['strong']);
});

test('CSV lines with quoted commas parse', () => {
  assert.deepEqual(parseCsvLine('Junge,"Nachname,Substantiv",,m'), ['Junge', 'Nachname,Substantiv', '', 'm']);
});
