// Routing, screens and glue.
import { openDb } from './db.js';
import { S, formatDate } from './strings.nl.js';

const view = document.getElementById('view');
const tabs = document.getElementById('tabs');
const dialog = document.getElementById('dialog');
const toastEl = document.getElementById('toast');

let db;
let appVersion = '…';
let waitingWorker = null;
let waitingVersion = null;
let updateAccepted = false;

// ---------- small DOM helper ----------

function h(tag, attrs = {}, ...children) {
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

function show(...children) {
  view.replaceChildren(...children.flat().filter((c) => c != null && c !== false));
  window.scrollTo(0, 0);
}

let toastTimer;
function toast(text) {
  toastEl.textContent = text;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, 3000);
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

// ---------- Leren (Home) ----------

function renderHome() {
  show(
    waitingWorker && h('button', { class: 'banner', id: 'update', onclick: applyUpdate },
      h('strong', {}, S.home.updateAvailable),
      h('span', { class: 'muted small' }, S.home.updateAction + (waitingVersion ? ` (${waitingVersion})` : ''))),
    h('h1', {}, S.home.title),
    h('p', { class: 'muted' }, S.home.notYet),
    h('div', { class: 'bottom' }, h('button', { class: 'primary', disabled: true }, S.home.start)),
  );
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
  if (currentTab() === 'leren' && !tabs.hidden) renderHome();
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
  await route();
  setupServiceWorker().catch((e) => console.warn('service worker:', e));
}

main();
