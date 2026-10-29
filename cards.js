// Building blocks of the cards (PLAN §10): lockups, sentences, notes, info bar.
// Prompt side: Dutch only, no gender color, no German. Gender color only after answering.
import { S } from './strings.nl.js';

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c);
  return el;
}

const SHAPES = { der: '■', die: '●', das: '▲' };

// Gender class for the card border and article color (nouns only, revealed side only).
export const genderClass = (word) => (word.pos === 'noun' ? `g-${word.article}` : '');

function article(a) {
  return h('span', { class: `art g-${a}` }, h('span', { class: 'shape', 'aria-hidden': 'true' }, SHAPES[a]), ' ', a);
}

// The German word as it is shown after answering (§10.4).
export function lockup(word) {
  const sep = () => h('span', { class: 'sep' }, ' · ');
  if (word.pos === 'noun') {
    const parts = [article(word.article), ' ', word.de];
    if (word.nDecl && word.genitive) parts.push(sep(), h('span', { class: 'form' }, word.genitive));
    if (word.plural) parts.push(sep(), h('span', { class: 'form' }, `die ${word.plural}`));
    return h('span', { class: 'lockup' }, parts);
  }
  if (word.pos === 'verb') {
    const parts = [];
    if (word.reflexive) parts.push(h('span', { class: 'form' }, 'sich'), ' ');
    if (word.separable && word.de.startsWith(word.separable)) {
      parts.push(h('span', { class: 'pill' }, word.separable), ' ', word.de.slice(word.separable.length));
    } else {
      parts.push(word.de);
    }
    // A bare case gets a plus (helfen + Dat.); a preposition follows the verb (warten auf + Akk.).
    if (word.governs) parts.push(' ', h('span', { class: 'form' }, /^(Nom|Akk|Dat|Gen)\./.test(word.governs) ? `+ ${word.governs}` : word.governs));
    if (word.forms) {
      parts.push(sep(), h('span', { class: 'form' }, `er ${word.forms.pres3}`));
      parts.push(sep(), h('span', { class: 'form' }, `${word.forms.aux === 'sein' ? 'ist' : 'hat'} ${word.forms.part}`));
    }
    return h('span', { class: 'lockup' }, parts);
  }
  return h('span', { class: 'lockup' }, word.de);
}

// The Dutch prompt word, with de/het for nouns.
export function promptWord(word) {
  const nl = word.nl[0];
  return word.pos === 'noun' && word.nlArticle ? `${word.nlArticle} ${nl}` : nl;
}

// German example with the target in bold (the [[…]] markers).
export function germanSentence(word) {
  const parts = word.example.de.split(/\[\[|\]\]/);
  return h('span', {}, parts.map((p, i) => (i % 2 ? h('b', {}, p) : p)));
}

// Dutch example with the prompt word in bold where it can be found.
export function dutchSentence(word) {
  const text = word.example.nl;
  const low = text.toLocaleLowerCase('nl-NL');
  for (const nl of word.nl) {
    const n = nl.toLocaleLowerCase('nl-NL');
    let i = low.indexOf(n);
    let len = n.length;
    if (i < 0 && !n.includes(' ') && n.length >= 4) {
      // An inflected form: a word in the sentence starting with the stem (werken → werkt).
      const stem = n.replace(/(en|e|n)$/, '');
      const m = new RegExp(`(^|[^\\p{L}])(${stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\p{L}*)`, 'u').exec(low);
      if (m && stem.length >= 3) { i = m.index + m[1].length; len = m[2].length; }
    }
    if (i >= 0) return h('span', {}, text.slice(0, i), h('b', {}, text.slice(i, i + len)), text.slice(i + len));
  }
  return h('span', {}, text);
}

// "NL: het meisje → DE: das Mädchen" when Dutch de/het doesn't predict der/die/das (§10.2).
export function deHetNote(word) {
  if (word.pos !== 'noun' || !word.nlArticle) return null;
  const mismatch = (word.nlArticle === 'het' && word.article !== 'das') || (word.nlArticle === 'de' && word.article === 'das');
  if (!mismatch) return null;
  return h('p', { class: 'note-line' }, S.session.deHet(`${word.nlArticle} ${word.nl[0]}`, `${word.article} ${word.de}`));
}

export function falseFriendNote(word) {
  const ff = word.falseFriend;
  if (!ff) return null;
  return h('p', { class: 'note-line' }, S.session.falseFriend(word.de, ff.nl), ' ', h('span', { class: 'muted' }, ff.note));
}

// Info bar, after reveal only: part of speech, extra forms, audio button.
export function infoBar(word, onPlay) {
  const T = S.session;
  const bits = [S.pos[word.pos] || word.pos];
  if (word.pos === 'noun' && word.pluralOnly) bits.push(T.pluralOnly);
  else if (word.pos === 'noun' && !word.plural) bits.push(T.noPlural);
  if (word.forms?.praet) bits.push(`${T.praet}: ${word.forms.praet}`);
  if (word.comparison) bits.push(`${T.comparison}: ${word.comparison.join(', ')}`);
  return h('div', { class: 'infobar' },
    h('span', {}, bits.join(' · ')),
    h('button', { class: 'icon', type: 'button', 'aria-label': T.play, onclick: onPlay }, '🔊'));
}

// What the speech engine says for a word: the article for nouns, the whole phrase otherwise.
export function spoken(word) {
  if (word.pos === 'noun') return `${word.article} ${word.de}`;
  return word.reflexive ? `sich ${word.de}` : word.de;
}
