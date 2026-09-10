import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: './tests', testMatch: ['source-bank-*.spec.ts', 'source-inference.spec.ts'],
  use: { baseURL: 'http://127.0.0.1:5283', browserName: 'chromium', channel: 'chrome' },
  webServer: { command: 'npm run dev -- --host 127.0.0.1 --port 5283 --strictPort', url: 'http://127.0.0.1:5283', reuseExistingServer: false } });
