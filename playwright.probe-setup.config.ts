import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'./tests',testMatch:['probe-setup-runtime.spec.ts','probe-app.spec.ts'],workers:1,timeout:60000,
 use:{baseURL:'http://127.0.0.1:5492',browserName:'chromium',channel:'chrome'},
 webServer:{command:'node tests/helpers/start-probe-setup.mjs',url:'http://127.0.0.1:5492',reuseExistingServer:false}});
