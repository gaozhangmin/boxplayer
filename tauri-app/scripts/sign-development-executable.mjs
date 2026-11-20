import {statSync} from 'node:fs'
import {dirname,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {spawnSync} from 'node:child_process'
import {requireDevelopmentIdentity,developmentConfiguration} from './development-signing.mjs'

export function signDevelopmentExecutable({root,executable,env=process.env,run=spawnSync}){
 const identity=requireDevelopmentIdentity(env.APPLE_SIGNING_IDENTITY)
 const {identifier}=developmentConfiguration({root,env})
 if(typeof identifier!=='string'||!/^[A-Za-z0-9][A-Za-z0-9.-]+$/.test(identifier))throw Error('Invalid development bundle identifier')
 if(!executable||!statSync(executable).isFile())throw Error('Missing Cargo development executable')
 const path=resolve(executable)
 const invoke=args=>{
  const result=run('/usr/bin/codesign',args,{env,stdio:'inherit'})
  if(result.error||result.status!==0)throw Error('Development executable signing/verification failed; app was not started')
 }
 invoke(['--force','--sign',identity,'--identifier',identifier,'--timestamp=none',path])
 invoke(['--verify','--strict',path])
 console.info(`[signing] development executable verified (${identifier})`)
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{signDevelopmentExecutable({root:resolve(dirname(fileURLToPath(import.meta.url)),'..'),executable:process.argv[2]})}
 catch(error){console.error(error.message);process.exitCode=1}
}
