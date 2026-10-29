// Answer checking (PLAN §7). Pure functions, no DOM; fully unit-tested.

export const ARTICLES = ['der', 'die', 'das'];
const SPELLED = { ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss', Ä: 'Ae', Ö: 'Oe', Ü: 'Ue' };

// Trim, collapse spaces, NFC, typographic apostrophes → plain ones; optionally ignore case.
export function normalize(s, { ignoreCase = true } = {}) {
  const t = String(s ?? '').normalize('NFC').replace(/[’‘ʼ´`]/g, "'").replace(/\s+/g, ' ').trim();
  return ignoreCase ? t.toLocaleLowerCase('de-DE') : t;
}

const FOLDED = { ä: 'a', ö: 'o', ü: 'u', ß: 's', Ä: 'A', Ö: 'O', Ü: 'U' };
const fold = (s) => s.replace(/[äöüßÄÖÜ]/g, (c) => FOLDED[c]);
const spellOut = (s) => s.replace(/[äöüßÄÖÜ]/g, (c) => SPELLED[c]);

// True when the answer differs from the target only in ä/ö/ü/ß (left out, or written out while
// the shortcut is off): an error the app must correct, never a typo (§7.2, §7.5).
export function umlautSlip(typed, target) {
  return typed !== target && (fold(typed) === fold(target) || fold(typed) === fold(spellOut(target)));
}

// Damerau-Levenshtein distance (optimal string alignment).
export function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

// Does the (normalized) input match the target, allowing ae/oe/ue/ss for ä/ö/ü/ß when the
// shortcut is on? Implemented on the target side, so genuine "ss"/"ue" in the input are never
// rewritten (§7.1). Returns 'exact', 'shortcut' or null.
export function matchForm(input, target, { shortcut = true } = {}) {
  if (input === target) return 'exact';
  if (!shortcut || !/[äöüß]/i.test(target)) return null;
  const pattern = [...target].map((c) => {
    if (!SPELLED[c]) return c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return `(?:${c}|${SPELLED[c]})`;
  }).join('');
  return new RegExp(`^${pattern}$`).test(input) ? 'shortcut' : null;
}

// How a word is written as an answer: nouns with their article, reflexive verbs with "sich".
export function displayForm(word) {
  if (word.pos === 'noun') return `${word.article} ${word.de}`;
  if (word.reflexive) return `sich ${word.de}`;
  return word.de;
}

// Every answer that counts as the word itself (reflexive verbs with or without "sich", §7.3).
export function answerForms(word) {
  if (word.pos === 'noun') return [`${word.article} ${word.de}`];
  if (word.reflexive) return [word.de, `sich ${word.de}`];
  return [word.de];
}

// Lookups over the whole dataset: which words share a Dutch prompt, and which German strings
// are real words (base form, plural, listed verb forms).
export function buildIndex(words) {
  const byNl = new Map();
  const realForms = new Map();
  const addReal = (form, id) => {
    if (!form) return;
    const k = normalize(form);
    if (!realForms.has(k)) realForms.set(k, new Set());
    realForms.get(k).add(id);
  };
  for (const w of words) {
    for (const nl of w.nl) {
      const k = normalize(nl);
      if (!byNl.has(k)) byNl.set(k, []);
      byNl.get(k).push(w);
    }
    addReal(w.de, w.id);
    addReal(w.plural, w.id);
    if (w.forms) for (const f of ['pres3', 'praet', 'part']) addReal(w.forms[f], w.id);
  }
  return { byNl, realForms };
}

function splitArticle(s) {
  const m = s.match(/^(der|die|das)\s+(.+)$/i);
  return m ? { article: m[1].toLocaleLowerCase('de-DE'), rest: m[2] } : { article: null, rest: s };
}

// Grades a typed answer on a production card (Dutch prompt → German word), §7.2.
// opts: { index, ignoreCase, umlautShortcuts, accepted: [answers allowed via "Ik had gelijk"] }
// Returns { outcome: 'correct'|'different'|'wrongReal'|'almost'|'wrong', note, canOverride, reason, target }.
// note: the proper spelling after an umlaut shortcut; reason: 'article' | 'umlaut' | null.
export function grade(rawInput, word, opts = {}) {
  const { index, ignoreCase = true, umlautShortcuts = true, accepted = [] } = opts;
  const norm = (s) => normalize(s, { ignoreCase });
  const input = norm(rawInput);
  const target = displayForm(word);
  const result = (outcome, extra = {}) => ({ outcome, note: null, canOverride: false, reason: null, target, ...extra });
  if (!input) return result('wrong');

  const forms = answerForms(word).map(norm);
  for (const f of forms) {
    const m = matchForm(input, f, { shortcut: umlautShortcuts });
    if (m === 'exact') return result('correct');
    if (m === 'shortcut') return result('correct', { note: target });
  }
  if (accepted.some((a) => norm(a) === input)) return result('correct');

  // A different valid German word for this Dutch prompt: no grade, try again.
  const others = [...(word.acceptAlso || [])];
  for (const w of index?.byNl.get(normalize(word.nl[0])) || []) if (w.id !== word.id) others.push(...answerForms(w));
  if (others.some((o) => matchForm(input, norm(o), { shortcut: umlautShortcuts }))) return result('different');

  const isNoun = word.pos === 'noun';
  const { article, rest } = splitArticle(input);
  const articleOk = !isNoun || article === word.article;
  const typed = isNoun ? rest : input;
  const wanted = isNoun ? [norm(word.de)] : forms;
  const partRight = wanted.some((w) => matchForm(typed, w, { shortcut: umlautShortcuts }));

  // Not offered when the only error is the article or an umlaut/ß: those are what the app teaches.
  if (isNoun && partRight) return result('wrong', { reason: 'article' });
  if (wanted.some((w) => umlautSlip(typed, w))) return result('wrong', { reason: isNoun && !articleOk ? 'article' : 'umlaut' });

  // Another real German word (or another form of this one): typo tolerance must never reward it.
  const own = normalize(word.de);
  if (index && [input, rest, input.replace(/^sich /, '')].some((c) => {
    const k = normalize(c);
    return k !== own && index.realForms.has(k);
  })) {
    return result('wrongReal', { canOverride: articleOk, reason: articleOk ? null : 'article' });
  }

  // One typo in the word part (target ≥ 4 letters). Nouns: the article must be exactly right.
  const letters = (x) => x.replace(/[^\p{L}]/gu, '').length;
  if (articleOk) {
    for (const w of wanted) {
      const variants = umlautShortcuts ? [w, spellOut(w)] : [w];
      if (letters(w) >= 4 && variants.some((v) => editDistance(typed, v) === 1)) {
        return result('almost', { canOverride: true });
      }
    }
  }
  return result('wrong', { canOverride: articleOk, reason: articleOk ? null : 'article' });
}

// The overall FSRS grade for a production answer: Good, Hard (only from Almost) or Again.
export function gradeToRating(outcome) {
  if (outcome === 'correct') return 3;
  if (outcome === 'almost') return 2;
  return 1;
}

// One field of a form card (plural, verb forms): exact/shortcut → correct; typo rule as above.
function gradeField(input, target, { ignoreCase, umlautShortcuts }) {
  const norm = (s) => normalize(s, { ignoreCase });
  const i = norm(input);
  const t = norm(target);
  const m = matchForm(i, t, { shortcut: umlautShortcuts });
  if (m) return { outcome: 'correct', note: m === 'shortcut' ? target : null };
  if (i && !umlautSlip(i, t) && t.replace(/[^\p{L}]/gu, '').length >= 4 && editDistance(i, t) === 1) {
    return { outcome: 'almost', note: null };
  }
  return { outcome: 'wrong', note: null };
}

// Plural card: "Stühle" and "die Stühle" both count; umlauts matter (§7.3).
export function gradePlural(rawInput, word, { ignoreCase = true, umlautShortcuts = true } = {}) {
  const input = normalize(rawInput, { ignoreCase: false }).replace(/^die\s+/i, '');
  return { ...gradeField(input, word.plural, { ignoreCase, umlautShortcuts }), target: `die ${word.plural}` };
}

// Verb-forms card: each field checked on its own; all must be right for Good (§7.3).
// inputs: { pres3, part, aux, praet? }. The present form is accepted with or without er/sie/es.
export function gradeVerbForms(inputs, word, { ignoreCase = true, umlautShortcuts = true } = {}) {
  const o = { ignoreCase, umlautShortcuts };
  const fields = {
    pres3: gradeField(normalize(inputs.pres3, { ignoreCase: false }).replace(/^(er|sie|es)\s+/i, ''), word.forms.pres3, o),
    part: gradeField(inputs.part, word.forms.part, o),
    aux: ({ hat: 'haben', ist: 'sein' }[normalize(inputs.aux)] || normalize(inputs.aux)) === word.forms.aux
      ? { outcome: 'correct', note: null } : { outcome: 'wrong', note: null },
  };
  if (inputs.praet !== undefined && word.forms.praet) fields.praet = gradeField(inputs.praet, word.forms.praet, o);
  const outcomes = Object.values(fields).map((f) => f.outcome);
  const rating = outcomes.includes('wrong') ? 1 : outcomes.includes('almost') ? 2 : 3;
  return { fields, rating };
}

// Where the answer differs from the target, for highlighting: [before, differing, after].
export function diffParts(input, target) {
  const a = input.toLocaleLowerCase('de-DE');
  const b = target.toLocaleLowerCase('de-DE');
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  let s = 0;
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  return [target.slice(0, p), target.slice(p, target.length - s), target.slice(target.length - s)];
}
