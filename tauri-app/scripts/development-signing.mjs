import {existsSync,readFileSync} from 'node:fs'
import {join,resolve} from 'node:path'
export function requireDevelopmentIdentity(identity){
 if(typeof identity!=='string'||!identity.trim()||identity.trim().startsWith('-')||/[\r\n\0]/.test(identity))throw Error('macOS native dev requires a stable signing identity: set APPLE_SIGNING_IDENTITY or .local/macos-signing.json')
 return identity.trim()
}
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

/** Tauri's supported JSON configuration layers; reject formats we cannot inspect. */
export function developmentConfiguration({root,env}){
 for(const alternate of ['tauri.conf.json5','Tauri.toml','tauri.macos.conf.json5','Tauri.macos.toml'])if(existsSync(join(root,'src-tauri',alternate)))throw Error('Signed macOS dev requires JSON configuration')
 const base=JSON.parse(readFileSync(join(root,'src-tauri/tauri.conf.json'),'utf8'))
 const platformFile=join(root,'src-tauri/tauri.macos.conf.json')
 const platform=existsSync(platformFile)?JSON.parse(readFileSync(platformFile,'utf8')):{}
 const overlay=env.TAURI_CONFIG?JSON.parse(env.TAURI_CONFIG):{}
 return {...base,...platform,...overlay,build:{...base.build,...platform.build,...overlay.build}}
}
function rejectConfiguredRunner({root,env,cli}){
 let config=developmentConfiguration({root,env})
 for(let i=1;i<cli.length;i++){
  const arg=cli[i]
  let value
  if(arg==='--config'||arg==='-c')value=cli[++i]
  else if(arg.startsWith('--config='))value=arg.slice(9)
  else if(arg.startsWith('-c'))value=arg.slice(2).replace(/^=/,'')
  else continue
  if(!value)throw Error('Missing Tauri JSON configuration')
  const patch=value.trim().startsWith('{')?JSON.parse(value):JSON.parse(readFileSync(resolve(root,value),'utf8'))
  config={...config,...patch,build:{...config.build,...patch.build}}
 }
 if(config.build.runner&&config.build.runner!=='cargo')throw Error('Custom Tauri runners are not supported by signed macOS dev')
}
export function needsDevelopmentRunner({args,platform}){
 const separator=args.indexOf('--')
 const cli=separator<0?args:args.slice(0,separator)
 return platform==='darwin'&&cli[0]==='dev'&&!cli.some(arg=>['--help','-h','--version','-V'].includes(arg))
}
/** Environment values replace Cargo config-file runners rather than concatenate
 * with existing arrays. Cover both Darwin triples, regardless of target source.
 * runnerPath is a no-space temporary launcher; all real paths travel via env.
 */
export function developmentRunnerEnvironment({root,args,platform,nodePath,runnerPath,env}){
 if(!needsDevelopmentRunner({args,platform}))return {}
 requireDevelopmentIdentity(env.APPLE_SIGNING_IDENTITY)
 const separator=args.indexOf('--')
 const cli=separator<0?args:args.slice(0,separator)
 const cargo=separator<0?[]:args.slice(separator+1)
 const application=cargo.indexOf('--')
 const forwarded=application<0?cargo:cargo.slice(0,application)
 if(cli.some(arg=>arg==='--runner'||arg.startsWith('-r')||arg.startsWith('--runner=')))throw Error('Custom Tauri runners are not supported by signed macOS dev')
 rejectConfiguredRunner({root,env,cli})
 if(forwarded.some(arg=>arg==='--config'||arg.startsWith('--config=')))throw Error('Forwarded Cargo --config can override signing; use Tauri --config before the first -- instead')
 if(!runnerPath||/\s/.test(runnerPath))throw Error('Signed dev launcher requires a path without whitespace')
 const result={BOXPLAYER_DEV_NODE:nodePath,BOXPLAYER_DEV_RUNNER_SCRIPT:join(root,'scripts/macos-dev-runner.sh'),BOXPLAYER_DEV_SIGNER:join(root,'scripts/sign-development-executable.mjs')}
 for(const target of ['AARCH64_APPLE_DARWIN','X86_64_APPLE_DARWIN']){
  const key=`CARGO_TARGET_${target}_RUNNER`
  if(env[key])throw Error('Remove the custom Cargo target runner before using signed macOS dev')
  result[key]=runnerPath
 }
 return result
}
