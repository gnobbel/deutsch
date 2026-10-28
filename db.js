// IndexedDB layer: stores, data migrations, snapshots, backup export/import.
// All progress lives here, on the device (PLAN §12).

export const DB_NAME = 'deutsch';

// Shape of the stored data. Bump it together with a new entry in MIGRATIONS.
export const SCHEMA_VERSION = 1;

// Structure of the IndexedDB stores. Bump IDB_VERSION when stores or indexes change;
// onupgradeneeded then creates whatever is missing. Data changes go through MIGRATIONS.
const IDB_VERSION = 1;
const STORE_DEFS = {
  cards: { keyPath: 'id', indexes: ['wordId'] },
  reviewLog: { keyPath: 'id', autoIncrement: true, indexes: ['cardId', 'ts'] },
  words: { keyPath: 'wordId' },
  reports: { keyPath: 'id', autoIncrement: true, indexes: ['wordId'] },
  settings: { keyPath: 'key' },
  meta: { keyPath: 'key' },
  snapshots: { keyPath: 'id', autoIncrement: true },
};

// Stores that hold the owner's data (everything except the snapshots themselves).
export const DATA_STORES = ['cards', 'reviewLog', 'words', 'reports', 'settings', 'meta'];
// Stores that hold learning progress (cleared by a pre-launch reset migration).
const PROGRESS_STORES = ['cards', 'reviewLog', 'words', 'reports'];

const MAX_SNAPSHOTS = 3;

export const DEFAULT_SETTINGS = {
  newPerDay: 10,
  retention: 0.9,
  ignoreCase: true,
  umlautShortcuts: true,
};

// Data migrations, in order. Each takes a dump ({store: rows[]}) at schema `to - 1`
// and returns it at schema `to`. Every entry needs a test (tests/unit/db.test.js).
// Before launch a migration may use `clearProgress` instead (PLAN §12.3).
export const MIGRATIONS = [];

export function clearProgress(dump) {
  const out = { ...dump };
  for (const s of PROGRESS_STORES) out[s] = [];
  return out;
}

// Pure: upgrades a dump from schema `from` to `to` with the given migrations.
export function migrate(dump, from, migrations = MIGRATIONS, to = SCHEMA_VERSION) {
  let d = structuredClone(dump);
  for (let v = from + 1; v <= to; v++) {
    const m = migrations.find((x) => x.to === v);
    if (!m) throw new Error(`Geen migratie naar schema ${v}`);
    d = m.up(d);
    for (const s of DATA_STORES) if (!Array.isArray(d[s])) d[s] = [];
  }
  return d;
}

// ---------- JSON with real dates ----------

// JSON has no date type, so dates are written as {"$date": "<ISO>"} and turned back
// into Date objects on import (PLAN §12.2).
export function toJSONWithDates(value) {
  return JSON.stringify(value, function (key, v) {
    const raw = this[key];
    if (raw instanceof Date) return { $date: isNaN(raw) ? null : raw.toISOString() };
    return v;
  }, 1);
}

export function parseJSONWithDates(text) {
  return JSON.parse(text, (key, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const keys = Object.keys(v);
      if (keys.length === 1 && keys[0] === '$date') return new Date(v.$date ?? NaN);
    }
    return v;
  });
}

// ---------- IndexedDB helpers ----------

function req(r) {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('transaction aborted'));
  });
}

function openRaw(name) {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(name, IDB_VERSION);
    r.onupgradeneeded = () => {
      const idb = r.result;
      const tx = r.transaction;
      for (const [store, def] of Object.entries(STORE_DEFS)) {
        const os = idb.objectStoreNames.contains(store)
          ? tx.objectStore(store)
          : idb.createObjectStore(store, { keyPath: def.keyPath, autoIncrement: !!def.autoIncrement });
        for (const ix of def.indexes || []) if (!os.indexNames.contains(ix)) os.createIndex(ix, ix);
      }
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.onblocked = () => reject(new Error('database blocked'));
  });
}

// ---------- The database ----------

export class Db {
  constructor(idb, opts) {
    this.idb = idb;
    this.schemaVersion = opts.schemaVersion;
    this.migrations = opts.migrations;
  }

  async get(store, key) {
    const tx = this.idb.transaction(store);
    return req(tx.objectStore(store).get(key));
  }

  async getAll(store) {
    const tx = this.idb.transaction(store);
    return req(tx.objectStore(store).getAll());
  }

  async put(store, value) {
    const tx = this.idb.transaction(store, 'readwrite');
    const key = await req(tx.objectStore(store).put(value));
    await done(tx);
    return key;
  }

  async getMeta(key) {
    return (await this.get('meta', key))?.value;
  }

  setMeta(key, value) {
    return this.put('meta', { key, value });
  }

  async getSettings() {
    const rows = await this.getAll('settings');
    const s = { ...DEFAULT_SETTINGS };
    for (const r of rows) s[r.key] = r.value;
    return s;
  }

  setSetting(key, value) {
    return this.put('settings', { key, value });
  }

  // All data stores as plain arrays.
  async dump() {
    const tx = this.idb.transaction(DATA_STORES);
    const out = {};
    await Promise.all(DATA_STORES.map(async (s) => { out[s] = await req(tx.objectStore(s).getAll()); }));
    return out;
  }

  // Replaces all data stores with the dump, in one transaction.
  async replaceAll(dump) {
    const tx = this.idb.transaction(DATA_STORES, 'readwrite');
    for (const s of DATA_STORES) {
      const os = tx.objectStore(s);
      os.clear();
      for (const row of dump[s] || []) os.put(row);
    }
    await done(tx);
  }

  async snapshot(reason, now = new Date()) {
    const data = await this.dump();
    const schemaVersion = (await this.getMeta('schemaVersion')) ?? this.schemaVersion;
    const tx = this.idb.transaction('snapshots', 'readwrite');
    const os = tx.objectStore('snapshots');
    os.add({ ts: now, reason, schemaVersion, data });
    const keys = await req(os.getAllKeys());
    for (const k of keys.slice(0, Math.max(0, keys.length - MAX_SNAPSHOTS))) os.delete(k);
    await done(tx);
  }

  listSnapshots() {
    return this.getAll('snapshots');
  }

  // Brings stored data up to the current schema. Snapshot first, always.
  async upgrade() {
    const stored = await this.getMeta('schemaVersion');
    if (stored === undefined) {
      await this.setMeta('schemaVersion', this.schemaVersion);
      return { from: null, to: this.schemaVersion };
    }
    if (stored >= this.schemaVersion) return { from: stored, to: stored };
    await this.snapshot(`voor migratie ${stored} → ${this.schemaVersion}`);
    const dump = migrate(await this.dump(), stored, this.migrations, this.schemaVersion);
    setMetaRow(dump, 'schemaVersion', this.schemaVersion);
    await this.replaceAll(dump);
    return { from: stored, to: this.schemaVersion };
  }

  // Builds the backup file. The file already carries `lastBackup = now`; the caller
  // stores that date with markBackedUp(now) once the file has actually been saved.
  async exportBackup({ appVersion = null, now = new Date() } = {}) {
    const data = await this.dump();
    setMetaRow(data, 'lastBackup', now);
    const text = toJSONWithDates({
      app: 'deutsch', format: 1, schemaVersion: this.schemaVersion, appVersion, exportedAt: now, data,
    });
    const d = now;
    const pad = (n) => String(n).padStart(2, '0');
    const filename = `deutsch-backup-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.json`;
    return { filename, text };
  }

  markBackedUp(now) {
    return this.setMeta('lastBackup', now);
  }

  // Reads and checks a backup file and migrates it to the current schema.
  // Throws an Error with a Dutch message when the file can't be used.
  parseBackup(text) {
    let file;
    try {
      file = parseJSONWithDates(text);
    } catch {
      throw new Error('Dit is geen geldig backupbestand.');
    }
    if (!file || file.app !== 'deutsch' || typeof file.data !== 'object' || !file.data) {
      throw new Error('Dit is geen backup van deze app.');
    }
    const v = file.schemaVersion;
    if (!Number.isInteger(v) || v < 1) throw new Error('Deze backup heeft een onbekende versie.');
    if (v > this.schemaVersion) throw new Error('Deze backup komt uit een nieuwere versie van de app. Werk de app eerst bij.');
    for (const s of DATA_STORES) {
      if (file.data[s] !== undefined && !Array.isArray(file.data[s])) throw new Error('Dit backupbestand is beschadigd.');
    }
    const data = migrate(file.data, v, this.migrations, this.schemaVersion);
    setMetaRow(data, 'schemaVersion', this.schemaVersion);
    const summary = {
      exportedAt: file.exportedAt instanceof Date ? file.exportedAt : null,
      words: data.words.length,
      cards: data.cards.length,
      reviews: data.reviewLog.length,
    };
    return { data, summary };
  }

  // Replaces everything with the parsed backup. Snapshot first.
  async restoreBackup(parsed) {
    await this.snapshot('voor terugzetten backup');
    await this.replaceAll(parsed.data);
  }

  // "Alles wissen": clears all data. A snapshot is kept as a safety net.
  async resetAll() {
    await this.snapshot('voor alles wissen');
    await this.replaceAll({ meta: [{ key: 'schemaVersion', value: this.schemaVersion }] });
  }

  close() {
    this.idb.close();
  }
}

function setMetaRow(dump, key, value) {
  dump.meta = (dump.meta || []).filter((r) => r.key !== key);
  dump.meta.push({ key, value });
}

export async function openDb({ name = DB_NAME, schemaVersion = SCHEMA_VERSION, migrations = MIGRATIONS } = {}) {
  const db = new Db(await openRaw(name), { schemaVersion, migrations });
  await db.upgrade();
  return db;
}
