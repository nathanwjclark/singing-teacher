import {workerBackedConfig} from './workerBackedConfig';

// Run: npx playwright test -c tests/motion-timeline.config.ts (CI runs it after the
// default browser checks). The fixture script seeds a native voice capture for the
// baseline fit and an encoded motion recording under <data>/fixture; the app keeps its
// own data under <data>/app.
export default workerBackedConfig({spec:'motion-timeline.spec.ts',prefix:'MOTION',port:5206,sciencePort:8806,data:'.local-e2e-motion',timeout:420_000,prepare:'tests/fixtures/prepare_motion_timeline.py',appData:'app'});
