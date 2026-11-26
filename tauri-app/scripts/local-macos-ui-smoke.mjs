import { createRequire } from 'node:module'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

if (process.platform !== 'darwin') {
  console.error('local-macos-ui-smoke.mjs is macOS-only (darwin).')
  process.exit(1)
}

const scriptDir = dirname(fileURLToPath(import.meta.url))
const tauriAppRoot = resolve(scriptDir, '..')
const outDir = resolve(
  process.env.BOXPLAYER_MACOS_OUT_DIR || join(tauriAppRoot, '.local', 'macos-local-ui'),
)
const shouldBuild = process.argv.includes('--build')

const require = createRequire(import.meta.url)
const viteBin = require.resolve('vite/bin/vite.js', { paths: [tauriAppRoot] })

const PORT = 1428
const BASE_URL = `http://127.0.0.1:${PORT}`

function rustEnv(baseEnv = process.env) {
  const env = { ...baseEnv }
  const localCargo = join(tauriAppRoot, '.local', 'cargo')
  if (existsSync(join(localCargo, 'bin', 'cargo'))) {
    env.CARGO_HOME ??= localCargo
    env.RUSTUP_HOME ??= join(tauriAppRoot, '.local', 'rustup')
    env.PATH = `${join(localCargo, 'bin')}${delimiter}${env.PATH ?? ''}`
  }
  const localMpv = join(tauriAppRoot, '.local', 'runtime', 'macos')
  if (!env.BOXPLAYER_MPV_RUNTIME && existsSync(join(localMpv, 'libmpv.dylib'))) {
    env.BOXPLAYER_MPV_RUNTIME = localMpv
  }
  return env
}

function runOrThrow(cmd, args, cwd, env) {
  const res = spawnSync(cmd, args, { cwd, env, stdio: 'inherit' })
  if (res.status !== 0) {
    throw new Error(`Command failed (${res.status}): ${cmd} ${args.join(' ')}`)
  }
}

async function waitForHttp(url, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url)
      if (res.ok) return
    } catch {
      // Server still booting.
    }
    await new Promise(r => setTimeout(r, 250))
  }
  throw new Error(`Timed out waiting for ${url}`)
}

async function listDirTree(dir, prefix = '') {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  const out = []
  for (const e of entries) {
    const rel = prefix ? `${prefix}/${e.name}` : e.name
    if (e.isDirectory()) out.push(...(await listDirTree(join(dir, e.name), rel)))
    else out.push(rel)
  }
  return out
}

function findWindowIdForPid(pid) {
  const swiftCode = `
import CoreGraphics
import Foundation
let targetPid = Int32(${Number(pid)})
if let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] {
    for w in list {
        if let ownerPid = w[kCGWindowOwnerPID as String] as? Int32, ownerPid == targetPid,
           let layer = w[kCGWindowLayer as String] as? Int, layer == 0,
           let bounds = w[kCGWindowBounds as String] as? [String: Any],
           let width = bounds["Width"] as? Double, width > 100,
           let wid = w[kCGWindowNumber as String] as? Int {
            print(wid)
            break
        }
    }
}
`
  const swiftRes = spawnSync('swift', ['-e', swiftCode], { encoding: 'utf-8', timeout: 8000 })
  if (swiftRes.status === 0) {
    const wid = (swiftRes.stdout || '').trim().split(/\s+/)[0]
    if (/^\d+$/.test(wid)) return wid
  }

  const osa = spawnSync(
    'osascript',
    [
      '-e',
      `tell application "System Events" to get id of first window of (first process whose unix id is ${Number(pid)})`,
    ],
    { encoding: 'utf-8', timeout: 5000 },
  )
  if (osa.status === 0) {
    const wid = (osa.stdout || '').trim()
    if (/^\d+$/.test(wid)) return wid
  }
  return null
}

async function killProcess(proc) {
  if (!proc || proc.exitCode !== null) return
  await new Promise(resolveExit => {
    const timer = setTimeout(() => {
      proc.kill('SIGKILL')
      resolveExit()
    }, 4000)
    proc.once('exit', () => {
      clearTimeout(timer)
      resolveExit()
    })
    proc.kill('SIGTERM')
  })
}

async function main() {
  const env = rustEnv(process.env)
  if (shouldBuild) {
    runOrThrow('pnpm', ['exec', 'vite', 'build'], tauriAppRoot, env)
    runOrThrow('cargo', ['build', '--manifest-path', 'src-tauri/Cargo.toml'], tauriAppRoot, env)
  }

  const bin = join(tauriAppRoot, 'src-tauri', 'target', 'debug', 'boxplayer-tauri-dev')
  if (!existsSync(bin)) {
    throw new Error(`Missing debug binary at ${bin}; pass --build or run cargo build first.`)
  }

  await mkdir(outDir, { recursive: true })
  const dataDir = await mkdtemp(join(tmpdir(), 'bp-tauri-macos-local-'))

  const server = spawn(
    process.execPath,
    [viteBin, 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'],
    { cwd: tauriAppRoot, env, stdio: ['ignore', 'pipe', 'pipe'] },
  )

  let appProc
  let appLogs = ''
  try {
    await waitForHttp(`${BASE_URL}/index.html`, 30000)
    appProc = spawn(bin, [], {
      cwd: tauriAppRoot,
      env: { ...env, BOXPLAYER_DEV_DATA_DIR: dataDir },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    appProc.stdout.on('data', d => {
      appLogs += d.toString()
    })
    appProc.stderr.on('data', d => {
      appLogs += d.toString()
    })

    const deadline = Date.now() + 15000
    let initializedFiles = []
    let windowId = null
    while (Date.now() < deadline) {
      if (appProc.exitCode !== null) {
        throw new Error(`Tauri macOS app exited early (${appProc.exitCode}): ${appLogs}`)
      }
      initializedFiles = await listDirTree(dataDir)
      windowId = findWindowIdForPid(appProc.pid)
      if (initializedFiles.length > 0 && windowId) break
      await new Promise(r => setTimeout(r, 500))
    }

    if (appProc.exitCode !== null) {
      throw new Error(`Tauri macOS app exited early (${appProc.exitCode}): ${appLogs}`)
    }

    // Give WKWebView a moment to finish initial paint once visible.
    await new Promise(r => setTimeout(r, 1200))
    if (!windowId) windowId = findWindowIdForPid(appProc.pid)

    const screenshotFile = join(outDir, 'macos-local-main.png')
    const scArgs = windowId ? ['-x', '-l', windowId, screenshotFile] : ['-x', screenshotFile]
    const shot = spawnSync('screencapture', scArgs, { encoding: 'utf-8' })

    const summary = {
      platform: 'macos-local',
      pid: appProc.pid,
      isolatedDataDir: dataDir,
      initializedFiles,
      windowId,
      captureMode: windowId ? 'window' : 'display-fallback',
      screenshot: shot.status === 0 ? 'macos-local-main.png' : null,
      screencaptureError: shot.status === 0 ? null : (shot.stderr || `exit ${shot.status}`).trim(),
    }

    await writeFile(join(outDir, 'macos-local-summary.json'), JSON.stringify(summary, null, 2), 'utf-8')
    console.log(`Tauri macOS local smoke finished -> ${outDir}`)
    if (shot.status !== 0) {
      throw new Error(`screencapture failed: ${summary.screencaptureError}`)
    }
  } finally {
    await killProcess(appProc)
    await killProcess(server)
    await rm(dataDir, { recursive: true, force: true }).catch(() => {})
  }
}

main().catch(err => {
  console.error('Tauri macOS local UI smoke failed:', err)
  process.exit(1)
})
