import {existsSync,readFileSync} from 'node:fs'
import {join} from 'node:path'
/** Local-only signing preference. Do not place a developer's identity in shared config. */
export function developmentSigning({root,env,platform,command}){
 if(platform!=='darwin'||!['build','dev'].includes(command))return {}
 if(env.APPLE_SIGNING_IDENTITY)return {}
 const path=join(root,'.local','macos-signing.json')
 if(!existsSync(path))return {}
 const value=JSON.parse(readFileSync(path,'utf8'))
 if(typeof value.identity!=='string'||!value.identity.trim()||value.identity==='-'||/[\r\n\0]/.test(value.identity))throw Error('Invalid local macOS development signing identity')
 return {APPLE_SIGNING_IDENTITY:value.identity.trim()}
}
/** Match the existing adhoc debug runtime policy while adding a stable identity.
 * The dev player loads the retained Frame libmpv signed by a different team.
 * Release signing/runtime policy remains controlled by the release configuration.
 */
export function developmentSigningConfig({platform,command,debug,identity}){
 return platform==='darwin'&&command==='build'&&debug&&identity
  ?{bundle:{macOS:{hardenedRuntime:false}}}:undefined
}
