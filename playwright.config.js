// e2e runs at iPhone size, in WebKit when it is installed, otherwise Chromium.
import { defineConfig, devices } from '@playwright/test';
import { existsSync, readdirSync } from 'node:fs';

const browsersDir = process.env.PLAYWRIGHT_BROWSERS_PATH;
const hasWebkit = !!browsersDir && existsSync(browsersDir) && readdirSync(browsersDir).some((d) => d.startsWith('webkit'));
const { defaultBrowserType, ...iphone } = devices['iPhone 13'];

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    ...iphone,
    browserName: hasWebkit ? 'webkit' : 'chromium',
    baseURL: 'http://localhost:8080/deutsch/',
    serviceWorkers: 'allow',
  },
  webServer: {
    command: 'node tools/serve.js --port 8080',
    url: 'http://localhost:8080/deutsch/',
    reuseExistingServer: true,
  },
});
