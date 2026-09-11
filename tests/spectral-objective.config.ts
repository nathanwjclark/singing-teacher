import {workerBackedConfig} from './workerBackedConfig';

// Run: npx playwright test -c tests/spectral-objective.config.ts (CI runs it after the
// default browser checks).
export default workerBackedConfig({spec:'spectral-objective.spec.ts',prefix:'SPECTRAL',port:5202,sciencePort:8802,data:'.local-e2e-spectral',timeout:300_000});
