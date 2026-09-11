import {defineConfig} from '@playwright/test';
import {fileURLToPath} from 'node:url';

// Browser checks that need the real scientific worker as well as the real app server.
// scripts/start-science-local.mjs starts both on their own ports, with a fresh data root
// seeded by a generated fixture script (synthetic evidence). Nothing is intercepted,
// and no provider key is available. Playwright stops the launcher, which stops the app
// and worker; the throwaway data root is recreated on the next run. Ports can be
// overridden with <PREFIX>_E2E_PORT and <PREFIX>_E2E_SCIENCE_PORT; the spec reads the
// data root from <PREFIX>_E2E_DATA to publish later captures. appData and scienceData
// name the app and worker directories inside the data root; env adds feature switches.
// Seeds record absolute paths, so the prepare script writes into the data root itself.
// serverTimeout bounds the build, the seed and the server start together.
export function workerBackedConfig({spec,prefix,port,sciencePort,data,timeout,prepare='tests/fixtures/prepare_voice_browser.py',appData='',scienceData='science-jobs',env={},serverTimeout=240_000}:{spec:string;prefix:string;port:number;sciencePort:number;data:string;timeout:number;prepare?:string;appData?:string;scienceData?:string;env?:Record<string,string>;serverTimeout?:number}){
  const root=fileURLToPath(new URL('..',import.meta.url));
  const appPort=Number(process.env[`${prefix}_E2E_PORT`]||port),workerPort=Number(process.env[`${prefix}_E2E_SCIENCE_PORT`]||sciencePort);
  process.env[`${prefix}_E2E_DATA`]=fileURLToPath(new URL(`../${data}`,import.meta.url));
  return defineConfig({
    testDir:'.',testMatch:spec,workers:1,timeout,
    use:{baseURL:`http://127.0.0.1:${appPort}`,browserName:'chromium',channel:'chrome'},
    webServer:{
      command:`rm -rf ${data} && npm run build && science/.venv/bin/python ${prepare} ${data} && node scripts/start-science-local.mjs`,
      cwd:root,url:`http://127.0.0.1:${appPort}/api/science/health`,
      env:{...env,PORT:String(appPort),SCIENCE_PORT:String(workerPort),LOCAL_DATA_DIR:appData?`${data}/${appData}`:data,SCIENCE_DATA_DIR:`${data}/${scienceData}`,
        PYTHONPATH:'.:science/src',OPENAI_ENV_FILE:'/dev/null',OPENAI_API_KEY:''},
      reuseExistingServer:false,timeout:serverTimeout,
    },
  });
}
