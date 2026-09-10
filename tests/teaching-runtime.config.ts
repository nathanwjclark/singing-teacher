import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'.',testMatch:'teaching-runtime.spec.ts',workers:1,use:{browserName:'chromium',channel:'chrome',headless:true}});
