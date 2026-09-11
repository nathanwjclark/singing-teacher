import {workerBackedConfig} from './workerBackedConfig';

// Run: npx playwright test -c tests/session-recompute.config.ts (CI runs it after the
// default browser checks).
export default workerBackedConfig({spec:'session-recompute.spec.ts',prefix:'RECOMPUTE',port:5203,sciencePort:8803,data:'.local-e2e-recompute',timeout:420_000});
