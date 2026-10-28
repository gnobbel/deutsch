// Fails when a file the service worker caches changed since origin/main but sw.js VERSION
// didn't, or when the precache list misses an app file (PLAN §12.4). Part of `npm run check`.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function parseSw(text) {
  const version = text.match(/const VERSION = '([^']+)'/)?.[1];
  const list = text.match(/const PRECACHE = \[([\s\S]*?)\];/)?.[1];
  if (!version || list === undefined) throw new Error('sw.js: VERSION or PRECACHE not found');
  return { version, precache: [...list.matchAll(/'([^']+)'/g)].map((m) => m[1]) };
}

function semverGreater(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
}

// Pure core, unit-tested. `base` is null when origin/main has no sw.js yet.
export function checkVersion({ version, precache, appFiles, exists, base }) {
  const errors = [];
  for (const f of appFiles) if (!precache.includes(f)) errors.push(`${f} is not in the PRECACHE list in sw.js`);
  for (const f of precache) if (f !== './' && !exists(f)) errors.push(`PRECACHE lists ${f}, which does not exist`);
  if (base) {
    if (base.changed.length && version === base.version) {
      errors.push(`These cached files changed but VERSION in sw.js is still ${version}: ${base.changed.join(', ')}. Bump it.`);
    } else if (version !== base.version && !semverGreater(version, base.version)) {
      errors.push(`VERSION ${version} must be higher than ${base.version} on origin/main`);
    }
  }
  return errors;
}

// Files the app loads, which must all be precached.
export function listAppFiles(root) {
  const out = [];
  for (const f of readdirSync(root)) {
    const p = join(root, f);
    if (!statSync(p).isFile()) continue;
    if (f === 'manifest.json' || f.endsWith('.html') || f.endsWith('.css')
      || (f.endsWith('.js') && f !== 'sw.js' && !f.endsWith('.config.js'))) out.push(f);
  }
  const walk = (dir, keep) => {
    if (!existsSync(join(root, dir))) return;
    for (const f of readdirSync(join(root, dir))) {
      const rel = `${dir}/${f}`;
      if (statSync(join(root, rel)).isDirectory()) walk(rel, keep);
      else if (keep(f)) out.push(rel);
    }
  };
  walk('fonts', (f) => f.endsWith('.woff2'));
  walk('icons', (f) => f.endsWith('.png'));
  walk('vendor', (f) => !f.endsWith('.txt') && !f.endsWith('.md') && !/^LICENSE/i.test(f));
  walk('words', () => true);
  return out.sort();
}

function git(root, ...args) {
  return execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] });
}

function main() {
  const root = fileURLToPath(new URL('..', import.meta.url));
  try {
    git(root, 'fetch', '--quiet', 'origin', 'main');
  } catch {
    console.warn('check-version: could not fetch origin/main, using the local copy');
  }
  const { version, precache } = parseSw(readFileSync(join(root, 'sw.js'), 'utf8'));
  let base = null;
  let baseSw = null;
  try { baseSw = git(root, 'show', 'origin/main:sw.js').toString(); } catch { /* not on main yet */ }
  if (baseSw) {
    const files = [...new Set([...precache.filter((f) => f !== './'), ...listAppFiles(root), 'sw.js'])];
    const changed = files.filter((f) => {
      const local = existsSync(join(root, f)) ? readFileSync(join(root, f)) : null;
      let remote = null;
      try { remote = git(root, 'show', `origin/main:${f}`); } catch { /* new file */ }
      if (f === 'sw.js') {
        // A change to sw.js other than the VERSION line itself counts too.
        const strip = (b) => b?.toString().replace(/const VERSION = '[^']+'/, '');
        return strip(local) !== strip(remote);
      }
      return !local || !remote || !local.equals(remote);
    });
    base = { version: parseSw(baseSw).version, changed };
  }
  const errors = checkVersion({
    version, precache, appFiles: listAppFiles(root), exists: (f) => existsSync(join(root, f)), base,
  });
  if (errors.length) {
    for (const e of errors) console.error('✗ ' + e);
    process.exit(1);
  }
  console.log(`✓ version check passed (VERSION ${version}${base ? `, origin/main has ${base.version}` : ', first version'})`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
