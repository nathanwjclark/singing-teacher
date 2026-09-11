import { defineConfig } from '@playwright/test';

// Browser checks run against the real local app server (built bundle plus its
// /api routes) on a dedicated port with throwaway data. They never reuse a
// running developer app or worker, its private captures or a provider credential.
const port = 5190;
export default defineConfig({
  testDir: './tests',
  use: { baseURL: `http://127.0.0.1:${port}`, browserName: 'chromium', channel: 'chrome' },
  webServer: {
    command: 'rm -rf .local-e2e-data && npm run build && node server/local.mjs',
    url: `http://127.0.0.1:${port}`,
    env: { PORT: String(port), LOCAL_DATA_DIR: '.local-e2e-data', OPENAI_ENV_FILE: '/dev/null', OPENAI_API_KEY: '', SCIENCE_URL: '', SCIENCE_TOKEN: '' },
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
