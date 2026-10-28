// Renders the app icons (PNG) from one SVG design using Playwright.
// Dev tool only: run `node tools/make-icons.js` after changing the design.
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const font = readFileSync(root + 'fonts/atkinson-700.woff2').toString('base64');

// Monochrome: dark tile, off-white letter. `pad` shrinks the glyph for maskable icons.
function svg(size, pad) {
  const fs = Math.round(size * (pad ? 0.42 : 0.58));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <style>@font-face{font-family:A;src:url(data:font/woff2;base64,${font}) format('woff2');font-weight:700}</style>
  <rect width="${size}" height="${size}" fill="#141619"/>
  <text x="50%" y="50%" dy="0.35em" text-anchor="middle" font-family="A" font-weight="700"
    font-size="${fs}" fill="#F7F6F2">Ä</text>
</svg>`;
}

const targets = [
  ['icons/apple-touch-icon.png', 180, false],
  ['icons/icon-192.png', 192, false],
  ['icons/icon-512.png', 512, false],
  ['icons/maskable-512.png', 512, true],
];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const [file, size, pad] of targets) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<body style="margin:0">${svg(size, pad)}</body>`);
  await page.evaluate(() => document.fonts.ready);
  writeFileSync(root + file, await page.screenshot({ type: 'png' }));
  console.log('wrote', file);
}
await browser.close();
