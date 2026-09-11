import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';

// Browser checks run against the real local app server (built bundle plus its
// /api routes) on a dedicated port with throwaway data. They never reuse a
// running developer app or worker, its private captures or a provider credential.
const port = 5190, dataDir = '.local-e2e-data';
// Specs that seed server-side inputs (such as an original probe archive) write them here.
process.env.E2E_DATA_DIR = resolve(import.meta.dirname, dataDir);
export default defineConfig({
  testDir: './tests',
  // A CI retry is reported as flaky rather than hidden; local runs never retry.
  retries: process.env.CI ? 1 : 0,
  // Needs the scientific worker as well; it has its own config (tests/spectral-objective.config.ts).
  testIgnore: ['spectral-objective.spec.ts'],
  use: { baseURL: `http://127.0.0.1:${port}`, browserName: 'chromium', channel: 'chrome' },
  webServer: {
    command: `rm -rf ${dataDir} && npm run build && node server/local.mjs`,
    url: `http://127.0.0.1:${port}`,
    env: { PORT: String(port), LOCAL_DATA_DIR: dataDir, OPENAI_ENV_FILE: '/dev/null', OPENAI_API_KEY: '', SCIENCE_URL: '', SCIENCE_TOKEN: '' },
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
