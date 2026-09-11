import {workerBackedConfig} from './workerBackedConfig';

// Run: npx playwright test -c tests/motion-audio.config.ts (CI runs it after the default
// browser checks). Seeded like motion-timeline: a native voice capture for the baseline
// fit and an encoded native motion recording under <data>/fixture; app data in <data>/app.
export default workerBackedConfig({spec:'motion-audio.spec.ts',prefix:'MOTION_AUDIO',port:5208,sciencePort:8808,data:'.local-e2e-motion-audio',timeout:420_000,prepare:'tests/fixtures/prepare_motion_timeline.py',appData:'app'});
