// Learning order (PLAN §4.1): computes every word's `rank` from its `freq` (place in the cleaned
// frequency list) and its CEFR `level`, so everyday words come early even when films rarely use them.
//   node tools/order.js            report: where words land, Goethe A1/A2 words still missing
//   node tools/order.js --write    rewrite the word files with the new ranks, split by band of 500
// Ids never change; ranks may (progress is keyed on id).
import { readdirSync, readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadGoethe } from './goethe.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const src = `${root}tools/sources/`;

// How strongly a level pulls a word forward (< 1) or pushes it back (> 1) in the frequency order.
export const LEVEL_WEIGHT = { A1: 0.5, A2: 0.9, B1: 1.4, B2: 1.8, C1: 2.2 };
// The guarantee on top: the k-th A1 word (in frequency order) comes no later than A1_SPREAD·k, and
// the k-th A2 word no later than (all A1 words)·A1_SPREAD + A2_SPREAD·k. So every A1 word sits in
// roughly the first 900 and the A2 words follow before ~2,000.
export const A1_SPREAD = 1.25;
export const A2_SPREAD = 1.5;
// Core everyday words come earlier still: the k-th one no later than CORE_SPREAD·k + 20, so all of
// them fit in about the first 400. Core = the closed everyday sets below plus a short list of
// daily-life essentials (food, home, transport, shopping, weather, body, directions, clothes).
export const CORE_SPREAD = 2.4;
export const CORE_GROUPS = ['numbers', 'weekdays', 'months', 'seasons', 'colors', 'family', 'dayparts', 'time-units'];
export const CORE_WORDS = new Set(`
  Brot Milch Wasser Kaffee Tee Bier Wein Saft Apfel Obst Gemüse Fleisch Fisch Käse Ei Kartoffel Frühstück
  Mittagessen Abendessen Essen essen trinken kochen Tisch Stuhl Bett Küche Bad Fenster Tür Zimmer Wohnung Haus
  Zug Bus Bahnhof Auto Fahrrad Flughafen Taxi Fahrkarte Haltestelle Straße Stadt Dorf Geld Euro kaufen einkaufen
  bezahlen Supermarkt Laden Preis teuer billig Wetter Sonne Regen Wind warm kalt Kopf Hand Auge Bauch Arzt krank
  Krankenhaus Apotheke links rechts geradeaus Arbeit Schule Lehrer Beruf Büro Kleidung Jacke Hose Schuh
  wohnen heißen arbeiten lernen Name Uhr Woche Monat Jahr heute morgen gestern Deutsch sprechen verstehen
  Montag Dienstag Mittwoch Donnerstag Freitag Samstag Sonntag Wochenende Januar Februar März April Mai Juni Juli
  August September Oktober November Dezember Frühling Sommer Herbst Winter eins zwei drei vier fünf sechs sieben
  acht neun zehn zwanzig hundert tausend schwarz weiß rot blau grün gelb braun grau
`.trim().split(/\s+/));
export const isCore = (w) => CORE_WORDS.has(w.de) || (w.groups || []).some((g) => CORE_GROUPS.includes(g));
export const BAND = 500;

// Sorts the words into learning order. Phrases and other entries with a `base` follow their base
// word at the earliest (the session waits for the base anyway, §6.1).
export function learningOrder(words) {
  const byFreq = [...words].sort((a, b) => a.freq - b.freq || a.id - b.id);
  const deadline = new Map();
  const a1 = byFreq.filter((w) => w.level === 'A1');
  a1.forEach((w, k) => deadline.set(w.id, A1_SPREAD * (k + 1)));
  byFreq.filter((w) => w.level === 'A2').forEach((w, k) => deadline.set(w.id, a1.length * A1_SPREAD + A2_SPREAD * (k + 1)));
  byFreq.filter(isCore).forEach((w, k) => deadline.set(w.id, Math.min(deadline.get(w.id) ?? Infinity, CORE_SPREAD * (k + 1) + 20)));
  const key = new Map(words.map((w) => [w.id, Math.min(w.freq * (LEVEL_WEIGHT[w.level] ?? 1), deadline.get(w.id) ?? Infinity)]));
  const byId = new Map(words.map((w) => [w.id, w]));
  // A word is never ahead of its base.
  const keyOf = (w, seen = new Set()) => {
    const b = w.base != null && !seen.has(w.id) ? byId.get(w.base) : null;
    if (!b) return key.get(w.id);
    seen.add(w.id);
    return Math.max(key.get(w.id), keyOf(b, seen) + 0.01);
  };
  return [...words].sort((a, b) => keyOf(a) - keyOf(b) || a.freq - b.freq || a.id - b.id);
}

export function readWordFiles(dir = `${root}words/`) {
  return readdirSync(dir).filter((f) => /^words-\d{4}-\d{4}\.json$/.test(f)).sort()
    .flatMap((f) => JSON.parse(readFileSync(dir + f, 'utf8')));
}

// Writes the words in learning order, ranks 1…n, into one file per band of 500.
export function writeWordFiles(ordered, dir = `${root}words/`) {
  for (const f of readdirSync(dir).filter((x) => /^words-\d{4}-\d{4}\.json$/.test(x))) unlinkSync(dir + f);
  const files = [];
  for (let i = 0; i < ordered.length; i += BAND) {
    const pad = (n) => String(n).padStart(4, '0');
    const name = `words-${pad(i + 1)}-${pad(i + BAND)}.json`;
    const band = ordered.slice(i, i + BAND).map((w, j) => ({ ...w, rank: i + j + 1 }));
    writeFileSync(dir + name, `${formatWords(band)}\n`);
    files.push(name);
  }
  return files;
}

// One entry per line, the way the word files have always been written.
export function formatWords(entries) {
  return `[\n${entries.map((w) => `  ${JSON.stringify(orderFields(w))}`).join(',\n')}\n]`;
}

const FIELD_ORDER = ['id', 'rank', 'freq', 'level', 'pos', 'de', 'article', 'plural', 'pluralOnly', 'nDecl', 'genitive', 'nl', 'nlArticle', 'nlHint'];
function orderFields(w) {
  const out = {};
  for (const k of FIELD_ORDER) if (k in w) out[k] = w[k];
  for (const k of Object.keys(w)) if (!(k in out)) out[k] = w[k];
  return out;
}

// ---------- frequency estimates for new words (from tools/sources) ----------

// A lemma's place on the curated scale: the rank.js lemma rank × 0.88, or the raw subtitle form
// rank × 0.62 when rank.js doesn't have it (both ratios measured on words 1–500).
export function freqEstimator() {
  const ranked = new Map();
  for (const l of readFileSync(`${src}ranked.tsv`, 'utf8').trim().split('\n').slice(1)) {
    const [r, lemma] = l.split('\t');
    if (!ranked.has(lemma.toLowerCase())) ranked.set(lemma.toLowerCase(), Number(r));
  }
  const raw = new Map();
  readFileSync(`${src}de_50k.txt`, 'utf8').trim().split('\n').forEach((l, i) => {
    const f = l.split(' ')[0];
    if (!raw.has(f)) raw.set(f, i + 1);
  });
  return (lemma) => {
    const k = lemma.toLowerCase();
    if (ranked.has(k)) return Math.max(1, Math.round(ranked.get(k) * 0.88));
    if (raw.has(k)) return Math.max(1, Math.round(raw.get(k) * 0.62));
    return 9000;
  };
}

// Goethe A1/A2 lemmas we deliberately don't add as their own entry (reason in tools/SOURCES.md).
export const SKIP = new Set(`
  mich mir dich dir ihn ihm uns euch ihnen sie ihr ihre dein sein es man wer wen wem
  her hin raus rein runter rauf drin dran drauf darauf daran davon dafür dabei damit
  danken entschuldigen Dank Ordnung Wiedersehen bisschen Ahnung Hause Paar Beispiel Fall Leid
  mögen möchten möchte gestorben geboren verheiratet ledig geschieden
  circa ca. z. B. usw. bzw. Sg. pl. Pommes frites Cent fährt besser
  Fax CD Disco Anrufbeantworter Prospekt Halbpension Lkw Kiosk Vorwahl Anrede Postleitzahl Absender Empfänger
  Geburtsjahr Geburtsort Familienstand ankreuzen anklicken Ansage Durchsage Bogen Anschluss Halle Schalter Automat
  Papiere heraus herein enden geöffnet ausländisch weiblich männlich Ehefrau Hausfrau
  Schluss Aussage international Anzeige Führung Lokal Apartment zurzeit automatisch bitter Zoll selbstständig Drucker kulturell Kilo Gramm Liter Meter Zentimeter Kilometer Prozent Grad
  Sonnabend Frühjahr Wochentag Deutsche Europa Deutschland Norden Süden Westen Osten erste zweite dritte Viertel
  Milliarde dreißig vierzig fünfzig sechzig siebzig achtzig neunzig elf zwölf
`.trim().split(/\s+/).map((x) => x.toLowerCase()));

// Estimates that rank.js gets wrong because the form also belongs to another word (weiß ← wissen).
export const FREQ_FIX = { weiß: 800, lange: 600 };

function report(words) {
  const goethe = loadGoethe();
  const est = freqEstimator();
  // A word counts as present when it is an entry, an accepted alternative, or part of a phrase.
  const have = new Set(words.flatMap((w) => [w.de, ...(w.acceptAlso || []), ...(w.pos === 'phrase' ? w.de.split(' ') : [])])
    .map((x) => x.toLowerCase().replace(/^(der|die|das|sich) /, '')));
  const missing = goethe ? [...goethe.values()].filter((g) => g.level !== 'B1' && !/[ -]/.test(g.lemma)
    && !have.has(g.lemma.toLowerCase()) && !SKIP.has(g.lemma.toLowerCase())) : [];
  // Where would the missing ones land among the words we have?
  const pseudo = missing.map((g, i) => ({ id: -1 - i, de: g.lemma, level: g.level, freq: FREQ_FIX[g.lemma] ?? est(g.lemma), missing: true, groups: [] }));
  const ideal = learningOrder([...words, ...pseudo]);
  const firstN = (n) => ideal.slice(0, n).filter((w) => w.missing);
  console.log(`order: ${words.length} words; levels ${['A1', 'A2', 'B1', 'B2', 'C1'].map((l) => `${l} ${words.filter((w) => w.level === l).length}`).join(', ')}`);
  if (!goethe) return console.log('(no tools/sources/goethe.tsv: run node tools/goethe.js for the missing-word report)');
  console.log(`Goethe A1/A2 words not in the data: ${missing.length} (A1 ${missing.filter((m) => m.level === 'A1').length})`);
  for (const n of [500, 1000]) {
    const m = firstN(n);
    console.log(`\nwould land in 1–${n} (${m.length}):`);
    console.log(m.map((w) => `${w.de}/${w.level}/${w.freq}`).join('  '));
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const words = readWordFiles();
  if (process.argv.includes('--write')) {
    const files = writeWordFiles(learningOrder(words));
    console.log(`order: wrote ${words.length} words to ${files.join(', ')}`);
  } else report(words);
}
