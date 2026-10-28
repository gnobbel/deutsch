// Compares articles, plurals and verb forms in words/ with independent dictionaries (PLAN §4.3 step 3):
// - nouns: gambolputty/german-nouns (built from German Wiktionary), Morphy as fallback
// - verbs: german-verbs-dict (Morphy / LanguageTool morphology)
// Disagreements we've looked at and resolved are listed, with a reason, in
// tools/crosscheck-resolved.json. Exits non-zero while any disagreement is unresolved.
// Run tools/fetch-sources.js first. Not part of `npm test`, since the sources aren't in the repo.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const src = root + 'tools/sources/';
const GENUS = { m: 'der', f: 'die', n: 'das' };

export function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur);
  return out;
}

// lemma → [{ articles: Set, plurals: Set, hasSingular }], one per Wiktionary entry (meaning).
function loadWiktionaryNouns() {
  const lines = readFileSync(src + 'german-nouns.csv', 'utf8').split('\n');
  const head = parseCsvLine(lines[0]);
  const col = (re) => head.map((h, i) => (re.test(h) ? i : -1)).filter((i) => i >= 0);
  const genusCols = col(/^genus( \d)?$/);
  const plCols = col(/^nominativ plural( \d|\*)?$/);
  const sgCols = col(/^nominativ singular( \d|\*)?$/);
  const nouns = new Map();
  for (const line of lines.slice(1)) {
    if (!line) continue;
    const r = parseCsvLine(line);
    if (!r[1].split(',').includes('Substantiv') || /Nachname|Vorname|Toponym/.test(r[1])) continue;
    const entry = {
      articles: new Set(genusCols.map((i) => GENUS[r[i]]).filter(Boolean)),
      plurals: new Set(plCols.map((i) => r[i]).filter((v) => v && v !== '—')),
      hasSingular: sgCols.some((i) => r[i] && r[i] !== '—'),
    };
    if (!nouns.has(r[0])) nouns.set(r[0], []);
    nouns.get(r[0]).push(entry);
  }
  return nouns;
}

const loadJson = (f) => JSON.parse(readFileSync(src + f, 'utf8'));
const join = (v) => (Array.isArray(v) ? v.join(' ') : v);
// The verb dictionary uses the old spelling (muß, läßt). A difference in ß/ss only is still
// reported (as "old spelling?") so it gets a look, because "heisst" for "heißt" is a real error.
const sameButSpelling = (a, b) => !!a && !!b && a !== b && a.replaceAll('ß', 'ss') === b.replaceAll('ß', 'ss');

// Pure: returns the disagreements for one word. Exported for tests.
export function checkWord(w, { wikt, morphyNouns, verbs }) {
  const issues = [];
  const add = (field, ours, source, note) => issues.push({ id: w.id, de: w.de, field, ours, source, note });
  if (w.pos === 'noun') {
    const entries = wikt.get(w.de);
    const morphy = morphyNouns[w.de];
    if (entries) {
      if (w.pluralOnly) {
        if (!entries.some((e) => !e.hasSingular)) add('pluralOnly', true, 'has a singular', 'Wiktionary');
      } else {
        const okArticle = entries.filter((e) => e.articles.has(w.article));
        if (!okArticle.length) add('article', w.article, [...new Set(entries.flatMap((e) => [...e.articles]))].join('/') || 'none', 'Wiktionary');
        else {
          const ok = okArticle.some((e) => (w.plural === null ? e.plurals.size === 0 : e.plurals.has(w.plural)));
          if (!ok) add('plural', w.plural, [...new Set(okArticle.flatMap((e) => [...e.plurals]))].join('/') || 'none', 'Wiktionary');
        }
      }
    } else if (morphy) {
      if (!w.pluralOnly && GENUS[morphy.G?.toLowerCase()] !== w.article) add('article', w.article, GENUS[morphy.G?.toLowerCase()] ?? 'none', 'Morphy');
      if (!w.pluralOnly && (morphy.NOM?.PLU ?? null) !== w.plural) add('plural', w.plural, morphy.NOM?.PLU ?? 'none', 'Morphy');
    } else add('noun', w.de, 'not found', 'no source');
  }
  if (w.pos === 'verb') {
    const v = verbs[w.de];
    if (!v) { add('verb', w.de, 'not found', 'no source'); return issues; }
    const pres3 = join(v['PRÄ']?.S?.[3]);
    const praet = join(v.PRT?.S?.[3]);
    const parts = v.PA2 || [];
    // Weak = regular: praet is stem + (e)te and the participle ends in -t.
    const stem = w.de.replace(/e?n$/, '');
    const ss = (x) => x.replaceAll('ß', 'ss');
    const regular = !!praet && (praet.split(' ')[0].endsWith('te')) && parts.some((p) => p.endsWith('t'))
      && ss(praet.split(' ')[0]).startsWith(ss(stem.slice(w.separable ? w.separable.length : 0)));
    if (w.strong === false && !regular) add('strong', false, `praet ${praet}, part ${parts.join('/')}`, 'Morphy');
    if (w.forms) {
      const note = (a, b) => (sameButSpelling(a, b) ? 'Morphy (old spelling?)' : 'Morphy');
      if (w.forms.pres3 !== pres3) add('forms.pres3', w.forms.pres3, pres3, note(w.forms.pres3, pres3));
      if (w.forms.praet !== praet) add('forms.praet', w.forms.praet, praet, note(w.forms.praet, praet));
      if (!parts.includes(w.forms.part)) add('forms.part', w.forms.part, parts.join('/'), note(w.forms.part, parts[0]));
    }
  }
  return issues;
}

function main() {
  const words = readdirSync(root + 'words').filter((f) => f.endsWith('.json')).sort()
    .flatMap((f) => JSON.parse(readFileSync(root + 'words/' + f, 'utf8')));
  const resolved = JSON.parse(readFileSync(root + 'tools/crosscheck-resolved.json', 'utf8'));
  const sources = { wikt: loadWiktionaryNouns(), morphyNouns: loadJson('german-words-dict/dist/words.json'), verbs: loadJson('german-verbs-dict/dist/verbs.json') };
  const all = words.flatMap((w) => checkWord(w, sources));
  const isResolved = (i) => resolved.some((r) => r.id === i.id && r.field === i.field);
  const open = all.filter((i) => !isResolved(i));
  const unused = resolved.filter((r) => !all.some((i) => i.id === r.id && i.field === r.field));
  const fmt = (i) => `#${i.id} ${i.de} — ${i.field}: ours ${JSON.stringify(i.ours)}, ${i.note} ${JSON.stringify(i.source)}`;
  const report = [
    `Crosscheck ${new Date().toISOString().slice(0, 10)}: ${words.length} words, ${words.filter((w) => w.pos === 'noun').length} nouns, ${words.filter((w) => w.pos === 'verb').length} verbs`,
    `Disagreements: ${all.length} (resolved ${all.length - open.length}, unresolved ${open.length})`,
    '', 'Unresolved:', ...open.map(fmt),
    '', 'Resolved:', ...all.filter(isResolved).map((i) => `${fmt(i)} → ${resolved.find((r) => r.id === i.id && r.field === i.field).reason}`),
    ...(unused.length ? ['', 'Resolutions that no longer match a disagreement (remove them):', ...unused.map((r) => `#${r.id} ${r.field}`)] : []),
  ].join('\n');
  writeFileSync(src + 'crosscheck-report.txt', report + '\n');
  console.log(report);
  if (open.length || unused.length) process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
