import {spawnSync} from 'node:child_process'
import {mkdirSync,readFileSync,writeFileSync,statSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {fileURLToPath} from 'node:url'
const root=fileURLToPath(new URL('../',import.meta.url))
const version=spawnSync('bun',['--version'],{encoding:'utf8'})
if(version.error||version.status!==0)throw new Error('Bun is required to build the bundled boxplayer host')
const runtimeVersion=version.stdout.trim()
// Match the Bun type contract used by the native project. Updating the runtime
// is an explicit dependency update, with process and SQLite regressions rerun.
const packageInfo=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'))
if(runtimeVersion!==packageInfo.devDependencies['@types/bun'])throw new Error(`Expected Bun ${packageInfo.devDependencies['@types/bun']}; found ${runtimeVersion}`)
const architectures={arm64:'aarch64',x64:'x86_64'}
const systems={darwin:'apple-darwin',linux:'unknown-linux-gnu',win32:'pc-windows-msvc'}
// A cross-target app must supply and validate its own native sidecar; never
// silently package a host executable for a different target.
const triple=process.env.TAURI_ENV_TARGET_TRIPLE||`${architectures[process.arch]}-${systems[process.platform]}`
if(!triple||triple.includes('undefined'))throw Error('Unsupported boxplayer native target')
const hostTriple=`${architectures[process.arch]}-${systems[process.platform]}`
if(triple!==hostTriple)throw Error(`Build boxplayer on the target platform (${triple}); host is ${hostTriple}`)
mkdirSync(new URL('../src-tauri/binaries/',import.meta.url),{recursive:true})
const output=`src-tauri/binaries/boxplayer-host-${triple}${process.platform==='win32'?'.exe':''}`
const result=spawnSync('bun',['build','--compile','--minify','native/boxplayer/main.ts','--outfile',output],{cwd:root,stdio:'inherit'})
if(result.error)throw new Error('Bun is required to build the bundled boxplayer host',{cause:result.error})
if(result.status!==0)process.exit(result.status||1)
const binary=new URL('../'+output,import.meta.url)
writeFileSync(new URL('../src-tauri/binaries/boxplayer-host-build.json',import.meta.url),JSON.stringify({runtime:'bun',version:runtimeVersion,target:triple,bytes:statSync(binary).size,sha256:createHash('sha256').update(readFileSync(binary)).digest('hex')},null,2)+'\n')
