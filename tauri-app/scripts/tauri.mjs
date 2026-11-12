import { existsSync } from 'node:fs'
import { delimiter, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { developmentSigning, developmentSigningConfig } from './development-signing.mjs'
import { loadProviderRegistration } from './provider-registration.mjs'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const env = { ...process.env }
if (['build', 'dev'].includes(process.argv[2])) {
  try {
    const registration = loadProviderRegistration({ root, env })
    Object.assign(env, registration.env, developmentSigning({root,env,platform:process.platform,command:process.argv[2]}))
    if(process.platform==='darwin'&&env.APPLE_SIGNING_IDENTITY)console.info('[signing] using configured macOS identity')
    console.info(`[registration] ${registration.configured.length} application settings configured; values are not logged`)
  } catch (error) {
    console.error(error.message)
    process.exit(1)
  }
}
const cargo = join(root, '.local/cargo')
if (existsSync(join(cargo, 'bin', process.platform === 'win32' ? 'cargo.exe' : 'cargo'))) {
  env.CARGO_HOME ??= cargo
  env.RUSTUP_HOME ??= join(root, '.local/rustup')
  env.PATH = `${join(cargo, 'bin')}${delimiter}${env.PATH ?? ''}`
}
const require = createRequire(import.meta.url)
const cli = join(dirname(require.resolve('@tauri-apps/cli/package.json')), 'tauri.js')
const args=process.argv.slice(2)
const signingConfig=developmentSigningConfig({platform:process.platform,command:args[0],debug:args.includes('--debug'),identity:env.APPLE_SIGNING_IDENTITY})
if(signingConfig)args.push('--config',JSON.stringify(signingConfig))
const child = spawn(process.execPath, [cli, ...args], { cwd: root, env, stdio: 'inherit' })
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
child.on('error', error => { console.error(error.message); process.exitCode = 1 })
child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0) })
