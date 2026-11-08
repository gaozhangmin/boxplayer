import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { setTimeout } from 'node:timers/promises'

const require = createRequire(import.meta.url)
let installEnv = process.env
const pnpm = (args) => spawnSync('pnpm', args, { stdio: 'inherit', shell: process.platform === 'win32', env: installEnv }).status ?? 1
let exitCode = 1
for (let attempt = 1; attempt <= 3; attempt++) {
  exitCode = pnpm(['install', '--frozen-lockfile'])
  if (exitCode === 0) {
    // A failed postinstall can leave pnpm's dependency tree in place while
    // Electron's executable is missing. Retry its installer in that case.
    try { require('electron'); break } catch { exitCode = pnpm(['rebuild', 'electron']) }
    if (exitCode === 0) break
  }
  if (attempt < 3) {
    // Retry the same official asset with a fresh URL, avoiding a cached gateway
    // failure. @electron/get still verifies Electron's packaged checksums.
    if (!process.env.ELECTRON_CUSTOM_FILENAME) {
      try {
        const { version } = require('electron/package.json')
        const platform = process.env.npm_config_platform || process.platform
        const arch = process.env.npm_config_arch || process.arch
        installEnv = { ...process.env, ELECTRON_CUSTOM_FILENAME: `electron-v${version}-${platform}-${arch}.zip?retry=${Date.now()}` }
      } catch { /* Dependency metadata is unavailable until installation resolves. */ }
    }
    console.info(`Dependency installation failed (attempt ${attempt}/3); retrying in 10 seconds.`)
    await setTimeout(10_000)
  }
}
process.exitCode = exitCode
