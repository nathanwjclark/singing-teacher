import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const directory=resolve(process.env.HTTPS_STATE_DIR||'.local-certs');
let config;try{config=JSON.parse(await readFile(resolve(directory,'config.json'),'utf8'))}catch{throw Error('Run npm run https:prepare first. No trusted local HTTPS configuration exists.')}
Object.assign(process.env,{HOST:config.ip,PORT:'5174',HTTPS_CERT:config.cert,HTTPS_KEY:config.key,PHONE_BASE_URL:config.phoneBaseUrl,DESKTOP_PORT:'5173',PHONE_SETUP_PORT:'5175',PHONE_SETUP_URL:config.setupUrl,PHONE_SETUP_TOKEN:config.setupToken,PHONE_PROFILE:config.profile,PHONE_CA_FINGERPRINT:config.fingerprint});
await import('../server/local.mjs');
