// Lists frequent lemmas from tools/sources/ranked.tsv that the word files don't contain,
// within the ranked range the bands already reach (PLAN §4.3). Run after tools/rank.js.
// Each listed word should be added, or be a deliberate skip (name, interjection, English,
// swear word, dictionary noise; see tools/SOURCES.md).
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const words = readdirSync(root + 'words').filter((f) => f.endsWith('.json'))
  .flatMap((f) => JSON.parse(readFileSync(root + 'words/' + f, 'utf8')));
const have = new Set(words.flatMap((w) => [w.de, ...w.de.split(' '), ...w.acceptAlso]).map((x) => x.toLowerCase()));
const ranked = readFileSync(root + 'tools/sources/ranked.tsv', 'utf8').trim().split('\n').slice(1)
  .map((l) => l.split('\t')).map(([rank, lemma, pos]) => ({ rank: Number(rank), lemma, pos }));
const reached = Math.max(...ranked.filter((r) => have.has(r.lemma.toLowerCase())).map((r) => r.rank).filter((r) => r <= 3000));
const limit = Number(process.argv[2]) || reached;
const missing = ranked.filter((r) => r.rank <= limit && !have.has(r.lemma.toLowerCase()));
console.log(`Ranked lemmas 1–${limit} not in the word files (${missing.length}):`);
console.log(missing.map((r) => `${r.rank} ${r.lemma}/${r.pos}`).join('  '));
