import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkVersion, parseSw, listAppFiles } from '../../tools/check-version.js';

const precache = ['./', 'index.html', 'app.js', 'words/words-0001-0500.json'];
const ok = { version: '0.1.1', precache, appFiles: ['index.html', 'app.js', 'words/words-0001-0500.json'], exists: () => true };

test('changed cached file with the same version fails', () => {
  const errors = checkVersion({ ...ok, base: { version: '0.1.1', changed: ['words/words-0001-0500.json'] } });
  assert.match(errors.join(), /VERSION in sw.js is still 0.1.1.*words-0001-0500.json/);
});

test('changed cached file with a bumped version passes', () => {
  assert.deepEqual(checkVersion({ ...ok, base: { version: '0.1.0', changed: ['app.js'] } }), []);
});

test('nothing cached changed: same version passes', () => {
  assert.deepEqual(checkVersion({ ...ok, base: { version: '0.1.1', changed: [] } }), []);
});

test('version must go up, not down', () => {
  assert.match(checkVersion({ ...ok, base: { version: '0.2.0', changed: ['app.js'] } }).join(), /must be higher/);
  assert.match(checkVersion({ ...ok, version: '0.1.10', base: { version: '0.1.9', changed: [] } }).join(), /^$/);
});

test('a word file missing from PRECACHE fails', () => {
  const errors = checkVersion({ ...ok, appFiles: [...ok.appFiles, 'words/words-0501-1000.json'], base: null });
  assert.match(errors.join(), /words-0501-1000.json is not in the PRECACHE/);
});

test('a PRECACHE entry that does not exist fails', () => {
  assert.match(checkVersion({ ...ok, exists: (f) => f !== 'app.js', base: null }).join(), /PRECACHE lists app.js/);
});

test('the real sw.js parses and lists every app file', () => {
  const root = new URL('../../', import.meta.url).pathname;
  const { version, precache: list } = parseSw(readFileSync(root + 'sw.js', 'utf8'));
  assert.match(version, /^\d+\.\d+\.\d+$/);
  for (const f of listAppFiles(root)) assert.ok(list.includes(f), `${f} precached`);
  assert.ok(!listAppFiles(root).includes('playwright.config.js'));
});
