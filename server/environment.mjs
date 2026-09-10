import {loadEnvFile} from 'node:process';
import {resolve} from 'node:path';

// Only the server loads secrets. Existing environment values retain precedence.
const paths=process.env.OPENAI_ENV_FILE?[process.env.OPENAI_ENV_FILE]:[resolve(import.meta.dirname,'../.env'),resolve(import.meta.dirname,'../../.env')];
for(const path of paths){
  try{loadEnvFile(path)}catch(error){
    if(error.code!=='ENOENT')throw Error('Could not load server environment configuration');
  }
}
