// Checks the word files in words/ against the schema in PLAN §4.2. Part of `npm test`.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const POS = ['noun', 'verb', 'adj', 'adv', 'prep', 'conj', 'pron', 'det', 'num', 'particle', 'interj', 'phrase'];
export const ARTICLES = ['der', 'die', 'das'];

// Closed confusable sets (PLAN §4.2 `groups`). Opposites use `opp:<a>-<b>`.
// Loose themes ("food", "house") don't belong here.
export const GROUPS = [
  'weekdays', 'months', 'seasons', 'numbers', 'ordinals', 'colors', 'family', 'directions',
  'questions', 'dayparts', 'time-units', 'modals', 'meals', 'senses', 'possessives',
];
const OPP = /^opp:[a-zäöüß]+-[a-zäöüß]+$/;

export function levelForRank(rank) {
  if (rank <= 500) return 'A1';
  if (rank <= 1000) return 'A2';
  if (rank <= 2000) return 'B1';
  if (rank <= 3500) return 'B2';
  return 'C1';
}

const isStr = (v) => typeof v === 'string' && v.trim() === v && v.length > 0;
const isStrOrNull = (v) => v === null || isStr(v);
const isBool = (v) => typeof v === 'boolean';

export function markers(sentence) {
  return [...sentence.matchAll(/\[\[([^[\]]*)\]\]/g)].map((m) => m[1]);
}

// Validates one file's entries. `range` is [first, last] rank for the file, or null.
export function validateWords(entries, { range = null, seenIds = new Set(), seenKeys = new Set() } = {}) {
  const errors = [];
  if (!Array.isArray(entries)) return ['file is not a JSON array'];
  const keys = seenKeys;
  const ranks = new Set();
  for (const w of entries) {
    const at = `#${w?.id} ${w?.de ?? '?'}`;
    const err = (m) => errors.push(`${at}: ${m}`);
    if (!w || typeof w !== 'object') { errors.push('entry is not an object'); continue; }

    if (!Number.isInteger(w.id) || w.id < 1) err('id must be a positive integer');
    else if (seenIds.has(w.id)) err('duplicate id');
    else seenIds.add(w.id);
    if (!Number.isInteger(w.rank) || w.rank < 1) err('rank must be a positive integer');
    else {
      if (ranks.has(w.rank)) err('duplicate rank');
      ranks.add(w.rank);
      if (range && (w.rank < range[0] || w.rank > range[1])) err(`rank outside ${range[0]}–${range[1]}`);
      if (w.level !== levelForRank(w.rank)) err(`level should be ${levelForRank(w.rank)}`);
    }
    if (!POS.includes(w.pos)) err(`unknown pos ${w.pos}`);
    if (!isStr(w.de)) err('de missing');
    if (!Array.isArray(w.nl) || !w.nl.length || !w.nl.every(isStr)) err('nl must be a non-empty list');
    if (!['de', 'het', null].includes(w.nlArticle)) err('nlArticle must be "de", "het" or null');
    if (!Array.isArray(w.acceptAlso) || !w.acceptAlso.every(isStr)) err('acceptAlso must be a list of strings');
    if (!isBool(w.showInitial)) err('showInitial must be true/false');
    if (!isBool(w.cognate)) err('cognate must be true/false');
    if (!isBool(w.check)) err('check must be true/false');
    if (w.clozeOnly !== undefined && !isBool(w.clozeOnly)) err('clozeOnly must be true/false');
    if (w.falseFriend !== null) {
      if (!w.falseFriend || !isStr(w.falseFriend.nl) || !isStr(w.falseFriend.note)) err('falseFriend must be null or {nl, note}');
      if (w.cognate !== false) err('false friends must have cognate: false');
    }
    if (!Array.isArray(w.groups)) err('groups must be a list');
    else for (const g of w.groups) if (!GROUPS.includes(g) && !OPP.test(g)) err(`unknown group ${g}`);

    if (!w.example || !isStr(w.example.de) || !isStr(w.example.nl)) err('example needs de and nl');
    else {
      const m = markers(w.example.de);
      const stray = w.example.de.replace(/\[\[[^[\]]*\]\]/g, '');
      if (/\[|\]/.test(stray)) err('example has broken [[ ]] markers');
      if (m.some((x) => !x.trim())) err('example has an empty marker');
      const sep = w.pos === 'verb' && w.separable;
      const okCount = w.pos === 'phrase' ? m.length >= 1 : sep ? m.length === 1 || m.length === 2 : m.length === 1;
      if (!okCount) err(`example has ${m.length} [[ ]] markers`);
      if (/\[\[|\]\]/.test(w.example.nl)) err('example.nl must not have markers');
    }

    const key = `${w.de}|${w.pos}|${w.nl?.[0]}`;
    if (keys.has(key)) err('duplicate (de, pos, meaning)');
    keys.add(key);

    if (w.pos === 'noun') {
      if (!ARTICLES.includes(w.article)) err('noun needs article der/die/das');
      if (w.pluralOnly === true) { if (w.plural !== null) err('pluralOnly noun must have plural: null'); }
      else if (w.pluralOnly !== undefined) err('pluralOnly must be true or absent');
      if (!isStrOrNull(w.plural)) err('noun needs plural (string or null)');
      if (w.nDecl !== undefined) {
        if (w.nDecl !== true) err('nDecl must be true or absent');
        if (!isStr(w.genitive) || !w.genitive.startsWith('des ')) err('nDecl noun needs genitive "des …"');
      }
      if (isStr(w.de) && w.de[0] !== w.de[0].toUpperCase()) err('noun must be capitalised');
      // Noun answers are typed with their article, so noun alternatives carry one too.
      for (const a of w.acceptAlso || []) if (/^[A-ZÄÖÜ]/.test(a)) err(`acceptAlso "${a}" needs its article`);
    } else if (w.article !== undefined || w.plural !== undefined) err('only nouns have article/plural');

    if (w.pos === 'verb') {
      if (!isBool(w.strong)) err('verb needs strong: true/false');
      if (!isStrOrNull(w.separable)) err('separable must be a prefix or null');
      else if (w.separable && isStr(w.de) && !w.de.startsWith(w.separable)) err('de must start with the separable prefix');
      if (!isBool(w.reflexive)) err('verb needs reflexive: true/false');
      if (!isStrOrNull(w.governs)) err('governs must be text or null');
      if (isStr(w.de) && w.de.startsWith('sich ')) err('write reflexive verbs without "sich" (reflexive: true)');
      if (w.strong && !w.forms) err('strong verb needs forms');
      if (w.forms) {
        const f = w.forms;
        if (!isStr(f.pres3) || !isStr(f.praet) || !isStr(f.part)) err('forms need pres3, praet, part');
        if (!['haben', 'sein'].includes(f.aux)) err('forms.aux must be haben or sein');
      }
    } else if (w.forms !== undefined || w.strong !== undefined) err('only verbs have forms/strong');

    if (w.comparison !== undefined && (!Array.isArray(w.comparison) || w.comparison.length !== 3 || !w.comparison.every(isStr))) {
      err('comparison must be [base, comparative, superlative]');
    }
    if (w.pos === 'phrase' && isStr(w.de) && !w.de.includes(' ')) err('phrase should have more than one word');
  }
  return errors;
}

function main() {
  const dir = fileURLToPath(new URL('../words/', import.meta.url));
  let files = [];
  try { files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort(); } catch { /* no words yet */ }
  if (!files.length) {
    console.log('validate: no word files yet');
    return;
  }
  const seenIds = new Set();
  const seenKeys = new Set();
  let total = 0;
  let checks = 0;
  let failed = false;
  for (const f of files) {
    const m = f.match(/^words-(\d{4})-(\d{4})\.json$/);
    if (!m) { console.error(`✗ ${f}: name must be words-NNNN-NNNN.json`); failed = true; continue; }
    let entries;
    try { entries = JSON.parse(readFileSync(join(dir, f), 'utf8')); } catch (e) {
      console.error(`✗ ${f}: invalid JSON (${e.message})`); failed = true; continue;
    }
    const errors = validateWords(entries, { range: [Number(m[1]), Number(m[2])], seenIds, seenKeys });
    for (const e of errors) console.error(`✗ ${f} ${e}`);
    failed ||= errors.length > 0;
    total += entries.length;
    checks += entries.filter((w) => w.check).length;
  }
  if (failed) process.exit(1);
  console.log(`✓ validate: ${total} words in ${files.length} file(s), ${checks} marked check`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
