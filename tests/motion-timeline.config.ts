import {defineConfig} from '@playwright/test';
import {fileURLToPath} from 'node:url';

// Real app server plus the real scientific worker (scripts/start-science-local.mjs)
// on their own ports, with a fresh data root seeded by generated native audio.
// Nothing under /api/science or /api/motion is intercepted.
// Run: npx playwright test -c tests/motion-timeline.config.ts
const root=fileURLToPath(new URL('..',import.meta.url));
const port=Number(process.env.MOTION_E2E_PORT||5206),sciencePort=Number(process.env.MOTION_E2E_SCIENCE_PORT||8806),data='.local-e2e-motion';
process.env.MOTION_E2E_FIXTURE=`${root}/${data}/fixture`;  // The spec uploads the encoded motion recording from here.
export default defineConfig({
 testDir:'.',testMatch:'motion-timeline.spec.ts',workers:1,timeout:420_000,
 use:{baseURL:`http://127.0.0.1:${port}`,browserName:'chromium',channel:'chrome'},
 webServer:{
  command:`rm -rf ${data} && npm run build && science/.venv/bin/python tests/fixtures/prepare_motion_timeline.py ${data} && node scripts/start-science-local.mjs`,
  cwd:root,url:`http://127.0.0.1:${port}/api/science/health`,
  env:{PORT:String(port),SCIENCE_PORT:String(sciencePort),LOCAL_DATA_DIR:`${data}/app`,SCIENCE_DATA_DIR:`${data}/science-jobs`,
   PYTHONPATH:'.:science/src',OPENAI_ENV_FILE:'/dev/null',OPENAI_API_KEY:''},
  reuseExistingServer:false,timeout:240_000,
 },
});
