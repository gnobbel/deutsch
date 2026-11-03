// Downloads the third-party sources into tools/sources/ (gitignored; never committed).
// See tools/SOURCES.md for what each one is and its license.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('./sources/', import.meta.url));
mkdirSync(dir, { recursive: true });

const FILES = [
  ['de_50k.txt', 'https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/de/de_50k.txt'],
  ['german-nouns.csv', 'https://raw.githubusercontent.com/gambolputty/german-nouns/main/german_nouns/nouns.csv'],
];
// Goethe-Institut word lists A1/A2/B1 (TSV extracts plus the original PDFs); goethe.de itself
// can't be reached from the agent's machine. Pinned to the commit checked on 2026-11-03.
const GIT = [['goethe-repo', 'https://github.com/ilkermeliksitki/goethe-institute-wordlist.git', 'cfef1c1']];
const NPM = [['german-verbs-dict', '3.4.0'], ['german-words-dict', '3.4.0'], ['german-adjectives-dict', '3.4.0']];

for (const [name, url] of FILES) {
  if (existsSync(dir + name)) { console.log('have', name); continue; }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  writeFileSync(dir + name, Buffer.from(await res.arrayBuffer()));
  console.log('downloaded', name);
}
for (const [pkg, version] of NPM) {
  if (existsSync(dir + pkg)) { console.log('have', pkg); continue; }
  const res = await fetch(`https://registry.npmjs.org/${pkg}/-/${pkg}-${version}.tgz`);
  if (!res.ok) throw new Error(`${pkg}: HTTP ${res.status}`);
  const tgz = `${dir}${pkg}.tgz`;
  writeFileSync(tgz, Buffer.from(await res.arrayBuffer()));
  mkdirSync(dir + pkg);
  execFileSync('tar', ['xzf', tgz, '-C', dir + pkg, '--strip-components=1']);
  console.log('downloaded', pkg, version);
}
for (const [name, url, commit] of GIT) {
  if (existsSync(dir + name)) { console.log('have', name); continue; }
  execFileSync('git', ['clone', '--quiet', url, dir + name]);
  execFileSync('git', ['-C', dir + name, 'checkout', '--quiet', commit]);
  console.log('downloaded', name, commit);
}
// The lemma → level table that tools/order.js uses for its missing-word report.
execFileSync(process.execPath, [fileURLToPath(new URL('./goethe.js', import.meta.url))], { stdio: 'inherit' });
