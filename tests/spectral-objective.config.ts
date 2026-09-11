import {defineConfig} from '@playwright/test';
import {fileURLToPath} from 'node:url';

// Real app server plus the real scientific worker (scripts/start-science-local.mjs)
// on their own ports, with a fresh data root seeded by a generated native capture.
// Nothing under /api/science is intercepted. Run: npx playwright test -c tests/spectral-objective.config.ts
const root=fileURLToPath(new URL('..',import.meta.url));
const port=Number(process.env.SPECTRAL_E2E_PORT||5202),sciencePort=Number(process.env.SPECTRAL_E2E_SCIENCE_PORT||8802),data='.local-e2e-spectral';
process.env.SPECTRAL_E2E_DATA=`${root}/${data}`;  // The spec publishes its later capture here.
export default defineConfig({
  testDir:'.',testMatch:'spectral-objective.spec.ts',workers:1,timeout:300_000,
  use:{baseURL:`http://127.0.0.1:${port}`,browserName:'chromium',channel:'chrome'},
  webServer:{
    command:`rm -rf ${data} && npm run build && science/.venv/bin/python tests/fixtures/prepare_voice_browser.py ${data} && node scripts/start-science-local.mjs`,
    cwd:root,url:`http://127.0.0.1:${port}/api/science/health`,
    env:{PORT:String(port),SCIENCE_PORT:String(sciencePort),LOCAL_DATA_DIR:data,SCIENCE_DATA_DIR:`${data}/science-jobs`,
      PYTHONPATH:'.:science/src',OPENAI_ENV_FILE:'/dev/null',OPENAI_API_KEY:''},
    reuseExistingServer:false,timeout:240_000,
  },
});
