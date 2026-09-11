import {workerBackedConfig} from './workerBackedConfig';

// Run: npx playwright test -c tests/visual-likelihood.config.ts (CI runs it after the
// default browser checks). The fixture script registers a native baseline directly in
// the worker data (<data>/jobs) and an encoded development recording in the app data.
export default workerBackedConfig({spec:'visual-likelihood.spec.ts',prefix:'VISUAL',port:5207,sciencePort:8807,data:'.local-e2e-visual',timeout:180_000,prepare:'tests/fixtures/prepare_visual_browser.py',scienceData:'jobs',env:{VISUAL_LIKELIHOOD_ENABLED:'1'}});
