import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'./tests',testMatch:'lidar-runtime.spec.ts',workers:1,use:{baseURL:process.env.LIDAR_QA_URL||'http://127.0.0.1:5286',browserName:'chromium',channel:'chrome',screenshot:'only-on-failure'}});
