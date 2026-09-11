import {workerBackedConfig} from './workerBackedConfig';

// Run: npx playwright test -c tests/source-bank-runtime.config.ts (CI runs it after the
// default browser checks). The fixture script runs the native source-loop app
// integration test into <data>/app and <data>/worker and ends on a failed forecast.
// Build, seed and start took 94-122 s locally (Apple silicon, shared load); the server
// timeout allows about 3x that for the slower CI runner.
export default workerBackedConfig({spec:'source-bank-runtime.spec.ts',prefix:'SOURCE_BANK',port:5210,sciencePort:8810,data:'.local-e2e-source-bank',timeout:240_000,prepare:'tests/fixtures/prepare_source_bank_runtime.py',appData:'app',scienceData:'worker',env:{PHONATION_SOURCE_ENABLED:'1'},serverTimeout:360_000});
