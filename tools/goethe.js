// Reads the Goethe-Institut word lists (A1, A2, B1) from tools/sources/goethe-repo (see
// tools/SOURCES.md; gitignored, never committed) and writes tools/sources/goethe.tsv:
// one lemma per line with the lowest level whose list contains it.
// The A2 and B1 lists repeat most earlier words, so a word's level is the first list it is on.
// Only our own `level` labels end up in the word files (PLAN §4.1).
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const src = fileURLToPath(new URL('./sources/', import.meta.url));
export const LEVELS = ['A1', 'A2', 'B1'];

// The A1 list starts with themed groups (numbers, weekdays, months, seasons, colors…) that the
// alphabetical part leaves out; these are those groups.
const A1_GROUPS = `eins zwei drei vier fünf sechs sieben acht neun zehn elf zwölf zwanzig dreißig vierzig fünfzig
  sechzig siebzig achtzig neunzig hundert tausend Million Milliarde Sekunde Minute Stunde Tag Woche Jahr Monat
  Wochentag Wochenende Sonntag Montag Dienstag Mittwoch Donnerstag Freitag Samstag Sonnabend Morgen Vormittag
  Mittag Nachmittag Abend Nacht Januar Februar März April Mai Juni Juli August September Oktober November Dezember
  Frühling Frühjahr Sommer Herbst Winter Euro Cent Meter Zentimeter Kilometer Grad Prozent Liter Gramm Kilo
  Deutschland Europa Deutsche deutsch schwarz grau blau grün weiß rot gelb braun Norden Süden Westen Osten
  erste zweite dritte halb Viertel Mama Papa Oma Opa`.split(/\s+/);
// The same for the A2 list's themed groups (family, jobs, colors, school, holidays, times).
const A2_GROUPS = `Bruder Cousin Cousine Eltern Enkel Enkelin Geschwister Großeltern Großmutter Großvater Kind Mutter
  Onkel Schwester Sohn Tante Tochter Vater Verwandte ledig verheiratet geschieden getrennt lila orange rosa
  Angestellte Arzt Ärztin Bäcker Doktor Fahrer Friseur Handwerker Hausfrau Hausmann Journalist Kaufmann Kellner Koch
  Krankenpfleger Krankenschwester Künstler Lehrer Lehrerin Mechaniker Musiker Polizist Rentner Sänger Schauspieler
  Techniker Verkäufer Österreich Schweiz Abitur Hausaufgabe Klasse Stundenplan Englisch Geschichte Kunst Mathematik
  Musik Sport Karneval Ostern Weihnachten Neujahr Silvester Mitternacht täglich tagsüber morgens vormittags mittags
  nachmittags abends nachts montags dienstags mittwochs donnerstags freitags samstags sonntags Feiertag Werktag
  Prüfung Aufgabe Lösung Wörterbuch Text Test Punkt`.split(/\s+/);

// "die Abfahrt" → "Abfahrt", "abholen(2)" → "abholen", "(sich) freuen" → "freuen",
// "der/die Bekannte" → "Bekannte", "Eltern (pl.)" → "Eltern".
export function lemmaOf(entry) {
  return entry
    .replace(/\([^)]*\)/g, ' ')
    .replace(/,.*$/, '')
    .replace(/^\s*((der|die|das)(\/(der|die|das))*)\s+/i, '')
    .replace(/^\s*sich\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function readGoethe(dir = `${src}goethe-repo/`) {
  const map = new Map(A1_GROUPS.map((lemma) => [lemma.toLowerCase(), { lemma, level: 'A1' }]));
  for (const level of LEVELS) {
    // The A2 groups come after the A1 list, so a word on both keeps A1.
    if (level === 'B1') for (const lemma of A2_GROUPS) if (!map.has(lemma.toLowerCase())) map.set(lemma.toLowerCase(), { lemma, level: 'A2' });
    const sub = `${dir}${level.toLowerCase()}/`;
    // a1/ has both per-letter files and a combined a1.tsv; read the per-letter ones.
    const files = readdirSync(sub).filter((f) => /^[a-z]\.tsv$/.test(f));
    for (const f of files) {
      for (const line of readFileSync(sub + f, 'utf8').split('\n')) {
        const head = line.split('\t')[0];
        // Skip the header and the Perfekt lines some lists add ("hat gedacht").
        if (!head || head === 'german word' || /^(hat|ist) /.test(head)) continue;
        // "ihr/ihm/ihn", "Samstag/Sonnabend": each alternative counts.
        const lemmas = /^[^ ]+\/[^ ]+$/.test(head.trim()) ? head.split('/').map(lemmaOf) : [lemmaOf(head)];
        for (const lemma of lemmas) {
          if (lemma && /\p{L}/u.test(lemma) && !map.has(lemma.toLowerCase())) map.set(lemma.toLowerCase(), { lemma, level });
        }
      }
    }
  }
  return map;
}

// The lemma → level map from tools/sources/goethe.tsv, or null when it hasn't been built.
export function loadGoethe() {
  if (!existsSync(`${src}goethe.tsv`)) return null;
  const map = new Map();
  for (const line of readFileSync(`${src}goethe.tsv`, 'utf8').trim().split('\n').slice(1)) {
    const [lemma, level] = line.split('\t');
    map.set(lemma.toLowerCase(), { lemma, level });
  }
  return map;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const map = readGoethe();
  const rows = [...map.values()].sort((a, b) => LEVELS.indexOf(a.level) - LEVELS.indexOf(b.level) || a.lemma.localeCompare(b.lemma, 'de'));
  writeFileSync(`${src}goethe.tsv`, ['lemma\tlevel', ...rows.map((r) => `${r.lemma}\t${r.level}`)].join('\n') + '\n');
  const count = (l) => rows.filter((r) => r.level === l).length;
  console.log(`goethe: wrote ${rows.length} lemmas (A1 ${count('A1')}, A2 ${count('A2')}, B1 ${count('B1')}) to tools/sources/goethe.tsv`);
}
