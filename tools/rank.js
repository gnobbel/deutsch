// Ranks German base forms (lemmas) by frequency (PLAN §4.1).
// Input: the OpenSubtitles 2018 frequency list (inflected, lowercased forms) plus the
// morphology dictionaries, all in tools/sources/ (run tools/fetch-sources.js first).
// Each form's count is split evenly over the lemmas it can belong to.
// Output: tools/sources/ranked.tsv (rank, lemma, pos, score, ambiguous, top forms).
// The word files take their order from this list; ids are never renumbered afterwards.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const src = fileURLToPath(new URL('./sources/', import.meta.url));

// Inflected function words the dictionaries don't cover. Form → lemma.
// These forms belong only to these lemmas (no noun/adjective readings).
const FUNCTION = {
  det: {
    der: 'der die das den dem des', ein: 'ein eine einen einem eines einer',
    kein: 'kein keine keinen keinem keines keiner', dieser: 'dieser diese dieses diesen diesem',
    jeder: 'jeder jede jedes jeden jedem', welcher: 'welcher welche welches welchen welchem',
    mein: 'mein meine meinen meinem meines meiner', dein: 'dein deine deinen deinem deines deiner',
    sein: 'sein seine seinen seinem seines seiner', unser: 'unser unsere unseren unserem unseres unserer unsre unsren',
    euer: 'euer eure euren eurem eures eurer', alle: 'alle aller allen allem alles',
    viel: 'viel viele vielen vieles vielem', wenig: 'wenig wenige wenigen weniger',
    manch: 'manche mancher manchen manches', solch: 'solche solcher solchen solches',
    ihr: 'ihr ihre ihren ihrem ihres ihrer', ander: 'andere anderen anderer anderes anderem',
  },
  // Contractions count toward their preposition.
  prep: { in: 'im ins', zu: 'zum zur', an: 'am ans', von: 'vom', bei: 'beim', auf: 'aufs', über: 'übers' },
  // Uninflected words the noun dictionary also lists as (rare) nouns.
  particle: {
    ja: 'ja', nein: 'nein', aber: 'aber', hallo: 'hallo', zurück: 'zurück', los: 'los', mal: 'mal', bitte: 'bitte',
    schon: 'schon', weg: 'weg', gar: 'gar', weil: 'weil', sondern: 'sondern', super: 'super', eins: 'eins',
  },
  pron: {
    ich: 'ich mich mir', du: 'du dich dir', er: 'er ihn ihm', sie: 'sie', es: 'es',
    wir: 'wir uns', ihr: 'ihr euch', sich: 'sich', man: 'man', wer: 'wer wen wem wessen',
    jemand: 'jemand jemanden jemandem', niemand: 'niemand niemanden niemandem',
    etwas: 'etwas', nichts: 'nichts', ihnen: 'ihnen', einander: 'einander',
  },
};

function addCandidate(map, form, lemma, pos) {
  if (!form || typeof form !== 'string') return;
  const f = form.toLowerCase();
  // The dictionaries use the old spelling (muß, daß); the subtitles use the new one.
  if (/ß$|ß(?=t$)/.test(f)) addCandidate(map, f.replace(/ß(?=t?$)/, 'ss'), lemma, pos);
  let set = map.get(f);
  if (!set) map.set(f, (set = new Map()));
  set.set(`${lemma}\t${pos}`, true);
}

function collectStrings(v, out) {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => collectStrings(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => collectStrings(x, out));
  return out;
}

export function buildLemmaMap() {
  const map = new Map();
  const exclusive = new Set();
  for (const [pos, table] of Object.entries(FUNCTION)) {
    for (const [lemma, forms] of Object.entries(table)) {
      for (const f of forms.split(' ')) { addCandidate(map, f, lemma, pos); exclusive.add(f); }
    }
  }
  const verbs = JSON.parse(readFileSync(src + 'german-verbs-dict/dist/verbs.json', 'utf8'));
  for (const [lemma, v] of Object.entries(verbs)) {
    const forms = [v.INF, v.PA1, v.EIZ, ...(v.PA2 || [])];
    for (const tense of ['KJ1', 'KJ2', 'PRÄ', 'PRT']) {
      for (const num of Object.values(v[tense] || {})) {
        for (const f of Object.values(num)) {
          // Split forms of separable verbs ("fange … an") look like the base verb; skip them.
          if (!Array.isArray(f)) forms.push(f);
        }
      }
    }
    if (v.IMP && !v.hasPrefix) forms.push(v.IMP.S, v.IMP.P);
    // Spoken short forms: "komm", "mach", "hab".
    for (const f of [v.IMP?.S, v['PRÄ']?.S?.[1]]) if (!v.hasPrefix && typeof f === 'string' && f.endsWith('e')) forms.push(f.slice(0, -1));
    for (const f of forms) addCandidate(map, f, lemma, 'verb');
  }
  const words = JSON.parse(readFileSync(src + 'german-words-dict/dist/words.json', 'utf8'));
  for (const [lemma, w] of Object.entries(words)) {
    if (!/^[A-ZÄÖÜ][a-zäöüß]+$/.test(lemma)) continue; // skip compounds with digits/hyphens, abbreviations
    for (const f of collectStrings({ ...w, G: undefined }, [lemma])) {
      if (!exclusive.has(f.toLowerCase())) addCandidate(map, f, lemma, 'noun');
    }
  }
  const adjs = JSON.parse(readFileSync(src + 'german-adjectives-dict/dist/adjectives.json', 'utf8'));
  for (const [lemma, a] of Object.entries(adjs)) {
    if (!/^[a-zäöüß]+$/.test(lemma)) continue;
    for (const f of collectStrings(a, [lemma])) if (!exclusive.has(f.toLowerCase())) addCandidate(map, f, lemma, 'adj');
  }
  return map;
}

function main() {
  const map = buildLemmaMap();
  const scores = new Map();
  const counts = new Map();
  for (const line of readFileSync(src + 'de_50k.txt', 'utf8').split('\n')) {
    const [form, n] = line.trim().split(' ');
    if (form && Number(n) && /^[a-zäöüß]+$/.test(form)) counts.set(form, Number(n));
  }
  for (const [form, count] of counts) {
    const cands = map.get(form) ? [...map.get(form).keys()] : [`${form}\t?`];
    // A form's count is shared out in proportion to how often each lemma's own base form
    // occurs ("tage" goes to Tag, not to tagen). The list is lowercased, so a noun that
    // competes with a verb/adjective/function reading ("habe": haben/Habe) gets a small share.
    const mixed = cands.some((k) => !k.endsWith('\tnoun'));
    const prior = (k) => ((counts.get(k.split('\t')[0].toLowerCase()) ?? 0) + 1) * (mixed && k.endsWith('\tnoun') ? 0.05 : 1);
    const total = cands.reduce((t, k) => t + prior(k), 0);
    for (const key of cands) {
      let s = scores.get(key);
      if (!s) scores.set(key, (s = { score: 0, forms: [], ambiguous: false }));
      s.score += (count * prior(key)) / total;
      if (cands.length > 1) s.ambiguous = true;
      if (s.forms.length < 5) s.forms.push(form);
    }
  }
  const ranked = [...scores.entries()].sort((a, b) => b[1].score - a[1].score).slice(0, 6000);
  const out = ['rank\tlemma\tpos\tscore\tambiguous\tforms'];
  ranked.forEach(([key, s], i) => out.push(`${i + 1}\t${key}\t${Math.round(s.score)}\t${s.ambiguous ? 'amb' : ''}\t${s.forms.join(',')}`));
  writeFileSync(src + 'ranked.tsv', out.join('\n') + '\n');
  console.log(`rank: wrote ${ranked.length} lemmas to tools/sources/ranked.tsv`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
