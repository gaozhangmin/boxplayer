import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { setTimeout } from 'node:timers/promises'

const require = createRequire(import.meta.url)
const pnpm = (args) => spawnSync('pnpm', args, { stdio: 'inherit', shell: process.platform === 'win32' }).status ?? 1
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
    console.info(`Dependency installation failed (attempt ${attempt}/3); retrying in 10 seconds.`)
    await setTimeout(10_000)
  }
}
process.exitCode = exitCode
