import {workerBackedConfig} from './workerBackedConfig';

// Run: npx playwright test -c tests/lidar-runtime.config.ts (CI runs it after the default
// browser checks). The fixture script runs the native LiDAR app integration test into
// <data>/app and <data>/worker, and the browser check continues from its adopted geometry.
// Build, seed and start took 85-90 s locally (Apple silicon, shared load); the server
// timeout allows about 3x that for the slower CI runner.
export default workerBackedConfig({spec:'lidar-runtime.spec.ts',prefix:'LIDAR',port:5209,sciencePort:8809,data:'.local-e2e-lidar',timeout:180_000,prepare:'tests/fixtures/prepare_lidar_runtime.py',appData:'app',scienceData:'worker',env:{LIDAR_FUSION_ENABLED:'1'},serverTimeout:300_000});
