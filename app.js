// Routing, screens and glue.
import { openDb } from './db.js';
import { S, formatDate } from './strings.nl.js';
import { h, lockup, promptWord, germanSentence, dutchSentence, deHetNote, falseFriendNote, infoBar, genderClass, spoken } from './cards.js';
import { Session, WORD_FILES, planToday } from './session.js';
import { secondsPerCard, estimateMinutes } from './srs.js';
import { grade, diffParts } from './grading.js';
import { speak, stop as stopSpeech, germanVoices } from './tts.js';

const view = document.getElementById('view');
const tabs = document.getElementById('tabs');
const dialog = document.getElementById('dialog');
const toastEl = document.getElementById('toast');

let db;
let appVersion = '…';
let waitingWorker = null;
let waitingVersion = null;
let updateAccepted = false;

function show(...children) {
  view.replaceChildren(...children.flat().filter((c) => c != null && c !== false));
  window.scrollTo(0, 0);
}

let toastTimer;
function toast(text, ms = 3000) {
  toastEl.textContent = text;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, ms);
}

function confirmDialog({ title, body, ok, cancel = S.settings.cancel }) {
  return new Promise((resolve) => {
    const close = (v) => { dialog.close(); resolve(v); };
    dialog.replaceChildren(
      h('h3', {}, title),
      ...[].concat(body).map((p) => h('p', {}, p)),
      h('div', { class: 'bottom' },
        h('button', { class: 'primary', onclick: () => close(true) }, ok),
        h('button', { onclick: () => close(false) }, cancel)),
    );
    dialog.oncancel = () => resolve(false);
    dialog.showModal();
  });
}

// ---------- routing ----------

const TABS = ['leren', 'woorden', 'instellingen'];

function currentTab() {
  const t = location.hash.slice(1);
  return TABS.includes(t) ? t : 'leren';
}

async function route() {
  if (session) return; // a running session owns the screen until it ends
  if (!(await db.getMeta('firstRunDone'))) {
    tabs.hidden = true;
    view.classList.add('full');
    return renderFirstRun();
  }
  view.classList.remove('full');
  const tab = currentTab();
  tabs.hidden = false;
  tabs.replaceChildren(...TABS.map((t) =>
    h('a', { href: `#${t}`, 'aria-current': t === tab ? 'page' : false }, S.tabs[t])));
  if (tab === 'leren') return renderHome();
  if (tab === 'woorden') return renderWords();
  return renderSettings();
}

// ---------- first run ----------

function isStandalone() {
  return navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
}

async function finishFirstRun() {
  await db.setMeta('firstRunDone', true);
  await requestPersistence();
  location.hash = '#leren';
  route();
}

function renderFirstRun() {
  if (isStandalone()) {
    return show(
      h('h1', {}, S.welcome.title),
      h('p', {}, S.welcome.body),
      h('p', { class: 'note' }, S.welcome.warning),
      h('div', { class: 'bottom' }, h('button', { class: 'primary', onclick: finishFirstRun }, S.welcome.ok)),
    );
  }
  show(
    h('h1', {}, S.install.title),
    h('ol', { class: 'steps' }, S.install.steps.map((s) => h('li', {}, s))),
    h('p', { class: 'muted' }, S.install.why),
    h('p', { class: 'note' }, S.install.warning),
    h('div', { class: 'bottom' }, h('button', { class: 'link', onclick: finishFirstRun }, S.install.continueBrowser)),
  );
}

// Asks the browser not to evict our data under storage pressure (PLAN §3).
async function requestPersistence() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch { /* not supported: nothing to do */ }
}

// ---------- data ----------

let wordsCache = null;
async function loadWords() {
  if (!wordsCache) {
    const lists = await Promise.all(WORD_FILES.map(async (f) => {
      const r = await fetch(f);
      if (!r.ok) throw new Error(`${f}: ${r.status}`);
      return r.json();
    }));
    wordsCache = lists.flat();
  }
  return wordsCache;
}

// Everything a session needs, read once. The minutes estimate uses the last answers only.
async function loadState() {
  const [words, cards, wordStates, recent, settings] = await Promise.all([
    loadWords(), db.getAll('cards'), db.getAll('words'), db.getRecent('reviewLog', 'ts', 3000), db.getSettings(),
  ]);
  return { words, cards, wordStates, seconds: secondsPerCard(recent), settings };
}

const dbStore = {
  putCard: (c) => db.put('cards', c),
  putWord: (w) => db.put('words', w),
  addLog: (r) => db.put('reviewLog', r),
  updateLog: (key, r) => db.put('reviewLog', { ...r, id: key }),
  addReport: (r) => db.put('reports', r),
};

// ---------- Leren (Home) ----------

let homeToken = 0;

async function renderHome() {
  const token = ++homeToken;
  const st = await loadState();
  if (token !== homeToken || session || currentTab() !== 'leren' || tabs.hidden) return;
  const T = S.home;
  const plan = planToday({
    words: st.words, wordStates: new Map(st.wordStates.map((w) => [w.wordId, w])), cards: new Map(st.cards.map((c) => [c.id, c])),
    settings: st.settings, seconds: st.seconds, now: new Date(),
  });
  const minutes = estimateMinutes([...plan.reviews, ...plan.learning], plan.newToday, st.seconds);
  const work = plan.reviews.length + plan.learning.length + plan.newToday;
  show(
    waitingWorker && h('button', { class: 'banner', id: 'update', onclick: applyUpdate },
      h('strong', {}, T.updateAvailable),
      h('span', { class: 'muted small' }, T.updateAction + (waitingVersion ? ` (${waitingVersion})` : ''))),
    h('h1', {}, T.title),
    work
      ? h('div', { class: 'today', id: 'today' },
        h('p', { class: 'big' }, T.reviews(plan.reviews.length), h('span', { class: 'muted' }, ` · ${T.minutes(minutes)}`)),
        h('p', {}, T.newToday(plan.newToday)),
        plan.learning.length > 0 && h('p', { class: 'muted' }, T.inProgress(new Set(plan.learning.map((c) => c.wordId)).size)))
      : h('p', { class: 'big', id: 'today' }, T.allDone),
    plan.paused && h('p', { class: 'note' }, T.paused),
    h('p', { class: 'muted small', id: 'newLeft' }, T.newLeft(plan.newLeft)),
    h('div', { class: 'bottom' }, h('button', { class: 'primary', id: 'start', disabled: !work, onclick: () => startSession(st) }, T.start)),
  );
}

// ---------- the session (PLAN §6, §8.2, §10) ----------

let session = null;
let sessionSettings = null;
let shownAt = 0;
const elapsed = () => Math.min(300000, Math.round(performance.now() - shownAt));

// Synchronous from the tap on Start to the first card, so iOS opens the keyboard.
function startSession(st) {
  sessionSettings = { ...st.settings };
  session = new Session({
    words: st.words, wordStates: st.wordStates, cards: st.cards, settings: st.settings, seconds: st.seconds,
    store: dbStore, onError: (e) => toast(S.error(e.message)),
  });
  tabs.hidden = true;
  view.classList.add('full');
  showScreen(session.next());
}

async function endSession() {
  stopSpeech();
  const s = session;
  await s.flush();
  session = null;
  hideKeyRow();
  location.hash = '#leren';
  route();
}

let spokenWordId = null;
function speakWord(word) {
  spokenWordId = word.id;
  speak(spoken(word), { voice: sessionSettings.audioVoice, rate: sessionSettings.audioRate });
}
function say(word) {
  if (sessionSettings.audio) speakWord(word);
}
const sayNow = (word) => () => speakWord(word);
// Audio is never on the prompt side (§10.6): a word still being spoken stops when its own
// prompt comes up (another word's audio gives nothing away and may finish).
function quietFor(word) {
  if (spokenWordId === word.id) stopSpeech();
  spokenWordId = null;
}

function sessionHeader() {
  const T = S.session;
  const sound = h('button', {
    class: 'icon', id: 'sound', type: 'button', 'aria-label': sessionSettings.audio ? T.soundOn : T.soundOff, 'aria-pressed': String(sessionSettings.audio),
    onclick: () => {
      sessionSettings.audio = !sessionSettings.audio;
      db.setSetting('audio', sessionSettings.audio);
      if (!sessionSettings.audio) stopSpeech();
      sound.textContent = sessionSettings.audio ? '🔊' : '🔇';
      sound.setAttribute('aria-label', sessionSettings.audio ? T.soundOn : T.soundOff);
      sound.setAttribute('aria-pressed', String(sessionSettings.audio));
    },
  }, sessionSettings.audio ? '🔊' : '🔇');
  return h('div', { class: 'session-head' },
    h('button', { class: 'icon', id: 'exit', type: 'button', 'aria-label': T.exit, onclick: endSession }, '✕'),
    h('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(session.progress() * 100)) },
      h('div', { style: `width:${(session.progress() * 100).toFixed(1)}%` })),
    sound);
}

function showScreen(screen) {
  shownAt = performance.now();
  if (!screen) return renderDone();
  if (screen.step === 'intro') return renderIntro(screen);
  if (screen.step === 'mc') return renderChoice(screen);
  return renderTyping(screen);
}

// The card frame: context sentence, the word at a fixed position, then whatever follows.
function card({ label, context, word, revealed = null, extra = [] }) {
  return h('section', { class: `card${revealed ? ` revealed ${genderClass(revealed)}` : ''}` },
    h('p', { class: 'label' }, label || ' '),
    h('p', { class: 'context' }, context),
    h('div', { class: 'word', id: 'word' }, word),
    extra);
}

function wordDetails(word) {
  return [
    h('p', { class: 'example-nl muted' }, promptWord(word), ' — ', word.example.nl),
    deHetNote(word),
    falseFriendNote(word),
    infoBar(word, sayNow(word)),
  ];
}

function renderIntro(screen, { again = false } = {}) {
  const T = S.session;
  const { word } = screen;
  const go = () => {
    if (again) return showScreen(session.next());
    session.answerIntro(screen, 'continue', elapsed());
    showScreen(session.next());
  };
  show(
    sessionHeader(),
    card({
      label: again ? T.wrong : T.newWord,
      context: germanSentence(word),
      word: lockup(word),
      revealed: word,
      extra: [again && h('p', { class: 'message', role: 'status' }, T.mcWrong), ...wordDetails(word)],
    }),
    h('div', { class: 'bottom' },
      h('button', { class: 'primary', id: 'next', onclick: go }, T.next),
      !again && h('button', {
        id: 'tooEasy',
        onclick: () => {
          session.answerIntro(screen, 'tooEasy', elapsed());
          showScreen(session.next());
        },
      }, T.tooEasy)),
  );
  hideKeyRow();
  document.getElementById('next').focus();
  say(word);
}

function renderChoice(screen) {
  const T = S.session;
  const { word } = screen;
  quietFor(word);
  show(
    sessionHeader(),
    card({ label: T.chooseLabel, context: dutchSentence(word), word: promptWord(word) }),
    h('div', { class: 'choices bottom' }, screen.options.map((o, i) => h('button', {
      class: 'choice',
      onclick: () => {
        const r = session.answerChoice(screen, i, elapsed());
        say(word);
        if (r.correct) {
          toast(`${T.correct} ✓`, 1200);
          showScreen(session.next());
        } else {
          renderIntro(screen, { again: true });
        }
      },
    }, o))),
  );
  hideKeyRow();
}

// A typing card. After answering, the same input stays focused (the keyboard stays up):
// Enter continues, or retypes the right answer after a mistake (§6.2, §7.2).
function renderTyping(screen, { message = null } = {}) {
  const T = S.session;
  const { word } = screen;
  quietFor(word);
  const input = answerInput();
  const form = h('form', { class: 'answer', onsubmit: (e) => {
    e.preventDefault();
    if (!input.value.trim()) return;
    const typed = input.value;
    const r = session.answerTyped(screen, typed, elapsed());
    if (r.outcome === 'different') return renderTyping(screen, { message: T.different });
    say(word);
    renderReveal(screen, r, typed);
  } }, input, h('button', { class: 'primary', type: 'submit' }, T.check));
  const label = screen.step === 'tooEasy' ? T.tooEasyPrompt : screen.step === 'relearn' ? T.relearn : '';
  show(
    sessionHeader(),
    card({
      label,
      context: dutchSentence(word),
      word: promptWord(word),
      extra: [
        screen.hint && h('p', { class: 'hint', id: 'hint' }, T.startsWith(screen.hint)),
        message && h('p', { class: 'message', id: 'message', role: 'status' }, message),
      ],
    }),
    form,
  );
  showKeyRow();
  input.focus();
}

function renderReveal(screen, r, typed, { overridden = null } = {}) {
  const T = S.session;
  const { word } = screen;
  const ok = r.outcome === 'correct' || overridden;
  const head = overridden ? T.correct
    : r.outcome === 'correct' ? (r.graduated ? T.graduated : T.correct)
      : r.outcome === 'almost' ? T.almost
        : r.reason === 'article' ? T.wrongArticle
          : r.reason === 'umlaut' ? T.wrongUmlaut
            : r.outcome === 'wrongReal' ? T.wrongReal : T.wrong;
  const target = r.target;
  const shownAnswer = r.outcome === 'almost' && !overridden
    ? h('p', { class: 'answer-line' }, T.youTyped, ': ', h('span', { class: 'typed' }, typed), ' → ',
      ...diffParts(typed.trim(), target).map((part, i) => (i === 1 ? h('mark', {}, part) : part)))
    : !ok ? h('p', { class: 'answer-line' }, T.youTyped, ': ', h('s', { class: 'typed' }, typed)) : null;

  const input = answerInput();
  input.placeholder = ok ? '' : T.retype;
  const retypeMsg = h('p', { class: 'message', id: 'retypeMsg', role: 'status' });
  const next = () => showScreen(session.next());
  const form = h('form', { class: 'answer', onsubmit: (e) => {
    e.preventDefault();
    if (ok) return next();
    const again = grade(input.value, word, {
      index: session.index, ignoreCase: sessionSettings.ignoreCase, umlautShortcuts: sessionSettings.umlautShortcuts,
      accepted: session.wordStates.get(word.id)?.accepted || [],
    });
    if (again.outcome === 'correct') return next();
    retypeMsg.textContent = T.retypeWrong;
    input.select();
  } }, input, h('button', { class: 'primary', type: 'submit', id: 'next' }, ok ? T.next : T.check));

  show(
    sessionHeader(),
    card({
      label: head,
      context: germanSentence(word),
      word: lockup(word),
      revealed: word,
      extra: [
        overridden && h('p', { class: 'message', id: 'overridden', role: 'status' }, T.overridden(overridden)),
        shownAnswer,
        r.note && !overridden && h('p', { class: 'note-line' }, T.spelling(r.note)),
        ...wordDetails(word),
      ],
    }),
    !ok && h('p', { class: 'small muted retype-label' }, T.retype),
    retypeMsg,
    form,
    r.canOverride && !overridden && h('button', {
      class: 'link', id: 'override', type: 'button',
      onclick: () => {
        const o = session.override();
        if (o) renderReveal(screen, r, typed, { overridden: o.accepted });
      },
    }, T.override),
  );
  showKeyRow();
  input.focus();
}

function answerInput() {
  return h('input', {
    type: 'text', id: 'answer', 'aria-label': S.session.answerLabel, placeholder: S.session.placeholder,
    autocapitalize: 'off', autocorrect: 'off', autocomplete: 'off', spellcheck: 'false', enterkeyhint: 'done', lang: 'de',
  });
}

function renderDone() {
  const T = S.session;
  const { done, ms, newWords } = session.stats;
  hideKeyRow();
  show(
    h('h1', {}, T.doneTitle),
    h('p', { class: 'big', id: 'doneStats' }, T.doneStats(done, Math.max(done ? 1 : 0, Math.round(ms / 60000)))),
    newWords > 0 && h('p', { class: 'muted' }, T.doneNew(newWords)),
    h('div', { class: 'bottom' }, h('button', { class: 'primary', id: 'back', onclick: endSession }, T.back)),
  );
}

// ---------- ä ö ü ß key row, just above the iOS keyboard (§10.5) ----------

let keyRow = null;
function positionKeyRow() {
  const vv = window.visualViewport;
  if (!keyRow || !vv) return;
  const keyboard = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
  keyRow.style.transform = `translateY(${-keyboard}px)`;
}
function showKeyRow() {
  if (!keyRow) {
    keyRow = h('div', { class: 'keyrow', id: 'keyrow' }, ['ä', 'ö', 'ü', 'ß'].map((c) => h('button', {
      type: 'button', tabindex: '-1',
      onpointerdown: (e) => e.preventDefault(), // keep the focus (and the keyboard) in the answer field
      onclick: () => {
        const input = document.getElementById('answer');
        if (!input) return;
        const start = input.selectionStart ?? input.value.length;
        const end = input.selectionEnd ?? input.value.length;
        input.setRangeText(c, start, end, 'end');
        input.focus();
      },
    }, c)));
    document.body.append(keyRow);
    window.visualViewport?.addEventListener('resize', positionKeyRow);
    window.visualViewport?.addEventListener('scroll', positionKeyRow);
  }
  keyRow.hidden = false;
  document.body.classList.add('with-keyrow');
  positionKeyRow();
}
function hideKeyRow() {
  if (keyRow) keyRow.hidden = true;
  document.body.classList.remove('with-keyrow');
}

// ---------- Woorden ----------

function renderWords() {
  show(h('h1', {}, S.words.title), h('p', { class: 'muted' }, S.words.notYet));
}

// ---------- Instellingen ----------

const RETENTION_OPTIONS = [0.8, 0.85, 0.88, 0.9, 0.92, 0.95];

async function renderSettings() {
  const T = S.settings;
  const s = await db.getSettings();
  const lastBackup = await db.getMeta('lastBackup');

  const out = h('output', { id: 'newPerDay' }, String(s.newPerDay));
  const step = (d) => async () => {
    const v = Math.max(0, Math.min(30, Number(out.textContent) + d));
    out.textContent = String(v);
    await db.setSetting('newPerDay', v);
  };
  const toggle = (key) => h('input', {
    type: 'checkbox', id: key, checked: s[key],
    onchange: (e) => db.setSetting(key, e.target.checked),
  });
  const fileInput = h('input', { type: 'file', accept: '.json,application/json', id: 'restoreFile', hidden: true, onchange: onRestoreFile });

  show(
    h('h1', {}, T.title),
    h('h2', {}, T.learning),
    h('div', { class: 'list' },
      h('div', { class: 'row' },
        h('label', { for: 'newPerDay' }, T.newPerDay, h('span', { class: 'hint' }, T.newPerDayHint)),
        h('div', { class: 'stepper' },
          h('button', { 'aria-label': 'minder', onclick: step(-1) }, '−'),
          out,
          h('button', { 'aria-label': 'meer', onclick: step(1) }, '+'))),
      h('div', { class: 'row' },
        h('label', { for: 'retention' }, T.retention, h('span', { class: 'hint' }, T.retentionHint)),
        h('select', { id: 'retention', onchange: (e) => db.setSetting('retention', Number(e.target.value)) },
          RETENTION_OPTIONS.map((r) => h('option', { value: r, selected: r === s.retention }, `${Math.round(r * 100)}%`)))),
      h('div', { class: 'row' }, h('label', { for: 'ignoreCase' }, T.ignoreCase), toggle('ignoreCase')),
      h('div', { class: 'row' }, h('label', { for: 'umlautShortcuts' }, T.umlautShortcuts), toggle('umlautShortcuts')),
    ),
    h('h2', {}, T.audio),
    h('div', { class: 'list' },
      h('div', { class: 'row' }, h('label', { for: 'audio' }, T.audioAuto), toggle('audio')),
      h('div', { class: 'row' },
        h('label', { for: 'audioRate' }, T.audioRate),
        h('select', { id: 'audioRate', onchange: (e) => db.setSetting('audioRate', Number(e.target.value)) },
          [0.7, 0.85, 1, 1.15].map((r) => h('option', { value: r, selected: r === s.audioRate }, `${Math.round(r * 100)}%`)))),
      h('div', { class: 'row' },
        h('label', { for: 'audioVoice' }, T.audioVoice),
        h('select', { id: 'audioVoice', onchange: (e) => db.setSetting('audioVoice', e.target.value || null) },
          h('option', { value: '' }, T.audioVoiceAuto),
          germanVoices().map((v) => h('option', { value: v.voiceURI, selected: v.voiceURI === s.audioVoice }, v.name))))),
    germanVoices().length === 0 && h('p', { class: 'small muted' }, T.audioNone),
    h('button', { id: 'audioTry', onclick: async () => {
      const cur = await db.getSettings();
      speak('Guten Tag! Wie geht es dir?', { voice: cur.audioVoice, rate: cur.audioRate });
    } }, T.audioTry),
    h('p', { class: 'small muted' }, T.audioHint),
    h('h2', {}, T.data),
    h('p', { class: 'small muted', id: 'lastBackup' }, `${T.lastBackup}: ${lastBackup ? formatDate(lastBackup) : T.never}`),
    h('button', { id: 'backup', onclick: () => onBackup().catch((e) => toast(S.error(e.message))) }, T.backup),
    h('p', { class: 'small muted' }, T.backupHint),
    h('button', { id: 'restore', onclick: () => fileInput.click() }, T.restore),
    fileInput,
    h('button', { id: 'reset', onclick: onReset }, T.reset),
    h('h2', {}, T.about),
    h('div', { class: 'list' },
      h('div', { class: 'row' }, h('span', {}, T.version), h('span', { id: 'version' }, appVersion))),
  );
}

function download(file) {
  const a = h('a', { href: URL.createObjectURL(file), download: file.name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

async function onBackup() {
  const now = new Date();
  const { filename, text } = await db.exportBackup({ appVersion, now });
  const file = new File([text], filename, { type: 'application/json' });
  const saved = async () => {
    await db.markBackedUp(now);
    toast(S.settings.backupSaved);
    if (currentTab() === 'instellingen') renderSettings();
  };
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return saved();
    } catch (e) {
      if (e.name === 'AbortError') return;
      if (e.name !== 'NotAllowedError') throw e;
      // iOS wants a fresh tap when preparing the file took too long.
      return offerShare(file, saved);
    }
  }
  download(file);
  return saved();
}

function offerShare(file, saved) {
  dialog.replaceChildren(
    h('p', {}, S.settings.backupReady),
    h('div', { class: 'bottom' },
      h('button', {
        class: 'primary',
        onclick: async () => {
          dialog.close();
          try {
            await navigator.share({ files: [file] });
            await saved();
          } catch (e) {
            if (e.name !== 'AbortError') toast(S.error(e.message));
          }
        },
      }, S.settings.shareBackup),
      h('button', { onclick: () => dialog.close() }, S.settings.cancel)),
  );
  dialog.showModal();
}

async function onRestoreFile(e) {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  let parsed;
  try {
    parsed = db.parseBackup(await file.text());
  } catch (err) {
    return toast(err.message);
  }
  const T = S.settings;
  const ok = await confirmDialog({
    title: T.restoreTitle,
    body: [T.restoreSummary(parsed.summary, formatDate(parsed.summary.exportedAt)), T.restoreWarning],
    ok: T.restoreOk,
  });
  if (!ok) return;
  try {
    await db.restoreBackup(parsed);
  } catch (err) {
    return toast(S.error(err.message));
  }
  toast(T.restored);
  route();
}

async function onReset() {
  const T = S.settings;
  if (!(await confirmDialog({ title: T.resetTitle1, body: T.resetBody1, ok: T.resetOk1 }))) return;
  if (!(await confirmDialog({ title: T.resetTitle2, body: T.resetBody2, ok: T.resetOk2 }))) return;
  await db.resetAll();
  toast(T.resetDone);
  route();
}

// ---------- service worker and updates (PLAN §12.4) ----------

function askVersion(worker) {
  return new Promise((resolve) => {
    if (!worker) return resolve(null);
    const ch = new MessageChannel();
    const timer = setTimeout(() => resolve(null), 3000);
    ch.port1.onmessage = (e) => { clearTimeout(timer); resolve(e.data); };
    worker.postMessage('GET_VERSION', [ch.port2]);
  });
}

async function onUpdateWaiting(worker) {
  waitingWorker = worker;
  waitingVersion = await askVersion(worker);
  // Only Home shows the banner, so an update never interrupts anything else.
  if (currentTab() === 'leren' && !tabs.hidden && !session) renderHome();
}

function applyUpdate() {
  updateAccepted = true;
  if (waitingWorker && waitingWorker.state === 'installed') waitingWorker.postMessage('SKIP_WAITING');
  else location.reload();
}

async function setupServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // Reload only when the owner tapped "Update beschikbaar".
    if (updateAccepted) location.reload();
  });
  const reg = await navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' });
  const active = navigator.serviceWorker.controller || (await navigator.serviceWorker.ready).active;
  appVersion = (await askVersion(active)) || appVersion;
  await db.setMeta('appVersion', appVersion);
  const v = document.getElementById('version');
  if (v) v.textContent = appVersion;

  const watch = (worker) => worker.addEventListener('statechange', () => {
    if (worker.state === 'installed' && navigator.serviceWorker.controller) onUpdateWaiting(worker);
  });
  if (reg.waiting && navigator.serviceWorker.controller) onUpdateWaiting(reg.waiting);
  if (reg.installing) watch(reg.installing);
  reg.addEventListener('updatefound', () => watch(reg.installing));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') reg.update().catch(() => {});
  });
}

// ---------- start ----------

async function main() {
  try {
    db = await openDb();
  } catch (e) {
    show(h('p', {}, S.error(e.message)));
    return;
  }
  window.addEventListener('hashchange', route);
  // iOS keeps the home-screen app in memory: refresh Home's numbers when it comes back.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !session && currentTab() === 'leren' && !tabs.hidden) renderHome();
  });
  await route();
  setupServiceWorker().catch((e) => console.warn('service worker:', e));
}

main();
