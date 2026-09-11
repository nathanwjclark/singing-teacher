import {defineConfig} from '@playwright/test';
// The spec builds the app and starts its own worker and app server through
// science/tests/control_browser_fixture.py (app port 5209 and an ephemeral worker port unless overridden).
export default defineConfig({testDir:'.',testMatch:'control-learning.spec.ts',workers:1,timeout:300_000,use:{browserName:'chromium',channel:'chrome',headless:true}});
