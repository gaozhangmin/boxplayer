import { createRequire } from 'node:module'
import { spawn, spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const tauriAppRoot = resolve(scriptDir, '..')
const outDir = resolve(
  process.env.BOXPLAYER_L2_OUT_DIR || join(tauriAppRoot, '.local', 'ci-native-l2'),
)
const require = createRequire(import.meta.url)
const viteBin = join(dirname(require.resolve('vite/package.json')), 'bin', 'vite.js')

const PORT = 1428
const BASE_URL = `http://127.0.0.1:${PORT}`
const WD_URL = process.env.TAURI_WEBDRIVER_URL || 'http://127.0.0.1:4444'

function parseMode() {
  const idx = process.argv.indexOf('--mode')
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1]
  if (process.platform === 'win32') return 'windows-webdriver'
  if (process.platform === 'linux') return 'linux-webdriver'
  if (process.platform === 'darwin') return 'macos-native'
  throw new Error(`Unsupported platform: ${process.platform}`)
}

function binaryPath() {
  const name = process.platform === 'win32' ? 'boxplayer-tauri-dev.exe' : 'boxplayer-tauri-dev'
  return join(tauriAppRoot, 'src-tauri', 'target', 'debug', name)
}

async function waitForHttp(url, timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url)
      if (res.ok) return res
    } catch {
      // Still booting.
    }
    await new Promise(r => setTimeout(r, 300))
  }
  throw new Error(`Timed out waiting for ${url}`)
}

async function killProcess(proc) {
  if (!proc || proc.exitCode !== null) return
  await new Promise(resolveExit => {
    const timer = setTimeout(() => {
      if (process.platform === 'win32' && proc.pid) {
        spawnSync('taskkill', ['/F', '/T', '/PID', String(proc.pid)], { stdio: 'ignore' })
      } else {
        proc.kill('SIGKILL')
      }
      resolveExit()
    }, 5000)
    proc.once('exit', () => {
      clearTimeout(timer)
      resolveExit()
    })
    if (process.platform === 'win32' && proc.pid) {
      spawnSync('taskkill', ['/F', '/T', '/PID', String(proc.pid)], { stdio: 'ignore' })
    } else {
      proc.kill('SIGTERM')
    }
  })
}

async function listDirTree(dir, prefix = '') {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  const out = []
  for (const e of entries) {
    const rel = prefix ? `${prefix}/${e.name}` : e.name
    if (e.isDirectory()) {
      out.push(...(await listDirTree(join(dir, e.name), rel)))
    } else {
      out.push(rel)
    }
  }
  return out
}

async function wdReq(method, path, body) {
  const res = await fetch(`${WD_URL}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok || json?.value?.error) {
    throw new Error(`WebDriver ${method} ${path} failed (${res.status}): ${JSON.stringify(json)}`)
  }
  return json.value
}

async function wdInvoke(sessionId, cmd, payload = {}) {
  const result = await wdReq('POST', `/session/${sessionId}/execute/async`, {
    script: `
      const done = arguments[arguments.length - 1];
      window.__TAURI_INTERNALS__.invoke(arguments[0], arguments[1])
        .then(data => done({ ok: true, data }))
        .catch(err => done({ ok: false, error: String((err && err.message) || err) }));
    `,
    args: [cmd, payload],
  })
  if (!result || result.ok !== true) {
    throw new Error(`Tauri IPC ${cmd} failed: ${JSON.stringify(result)}`)
  }
  return result.data
}

async function wdScreenshot(sessionId, filename) {
  const b64 = await wdReq('GET', `/session/${sessionId}/screenshot`)
  await writeFile(join(outDir, filename), Buffer.from(b64, 'base64'))
}

async function runNativeWebdriver(bin, dataDir, platform) {
  const summary = { mode: `${platform}-webdriver`, dataDir, windows: [], screenshots: [] }
  await waitForHttp(`${WD_URL}/status`, 30000)

  const createSession = async () => {
    const val = await wdReq('POST', '/session', {
      capabilities: {
        alwaysMatch: {
          'tauri:options': { application: bin },
        },
      },
    })
    return val.sessionId
  }

  const waitForMounted = async sid => {
    const deadline = Date.now() + 45000
    while (Date.now() < deadline) {
      try {
        const ready = await wdReq('POST', `/session/${sid}/execute/sync`, {
          script: `
            const root = document.querySelector('#app');
            return Boolean(root && root.children.length > 0 && window.__TAURI_INTERNALS__);
          `,
          args: [],
        })
        if (ready) return
      } catch {
        // Still initializing.
      }
      await new Promise(r => setTimeout(r, 300))
    }
    throw new Error(`Timed out waiting for #app + __TAURI_INTERNALS__ in ${platform} WebDriver`)
  }

  let sid = await createSession()
  try {
    await waitForMounted(sid)
    await new Promise(r => setTimeout(r, 500))

    const runtimeInfo = await wdInvoke(sid, 'runtime_info')
    if (runtimeInfo.platform !== platform) {
      throw new Error(`Expected platform ${platform}, got ${runtimeInfo.platform}`)
    }
    summary.runtimeInfo = runtimeInfo

    await wdScreenshot(sid, 'l2-native-main-initial.png')
    summary.screenshots.push('l2-native-main-initial.png')

    const initialSettings = await wdInvoke(sid, 'settings_get')
    const updatedSettings = await wdInvoke(sid, 'settings_update', {
      expectedRevision: initialSettings.revision,
      patch: { theme: 'dark', sidebarCollapsed: true },
    })
    if (
      updatedSettings.revision !== initialSettings.revision + 1 ||
      updatedSettings.theme !== 'dark' ||
      updatedSettings.sidebarCollapsed !== true
    ) {
      throw new Error(`Unexpected updated settings: ${JSON.stringify(updatedSettings)}`)
    }

    const darkApplied = await wdReq('POST', `/session/${sid}/execute/sync`, {
      script: "return document.documentElement.classList.contains('dark');",
      args: [],
    })
    if (!darkApplied) {
      throw new Error('Expected <html class="dark"> after dark theme update')
    }
    await new Promise(r => setTimeout(r, 300))
    await wdScreenshot(sid, 'l2-native-main-dark.png')
    summary.screenshots.push('l2-native-main-dark.png')

    const mainHandle = await wdReq('GET', `/session/${sid}/window`)
    let knownHandles = new Set(await wdReq('GET', `/session/${sid}/window/handles`))

    for (const win of [
      { kind: 'settings', view: 'general', file: 'l2-native-settings.png' },
      { kind: 'player', view: undefined, file: 'l2-native-player.png' },
    ]) {
      await wdInvoke(sid, 'window_open', { kind: win.kind, view: win.view })
      if (platform === 'linux') await new Promise(r => setTimeout(r, 1000))
      const deadline = Date.now() + (platform === 'windows' ? 15000 : 0)
      let newHandle
      do {
        const handles = await wdReq('GET', `/session/${sid}/window/handles`)
        newHandle = handles.find(h => !knownHandles.has(h))
        if (newHandle) {
          knownHandles = new Set(handles)
          break
        }
        if (platform === 'windows') await new Promise(r => setTimeout(r, 300))
      } while (Date.now() < deadline)
      if (platform === 'windows' && !newHandle) throw new Error(`WebView2 did not open ${win.kind}`)
      if (newHandle) {
        await wdReq('POST', `/session/${sid}/window`, { handle: newHandle })
        if (platform === 'windows') await waitForMounted(sid)
        else await new Promise(r => setTimeout(r, 600))
        await wdScreenshot(sid, win.file)
        summary.windows.push(win.kind)
        summary.screenshots.push(win.file)
        await wdReq('POST', `/session/${sid}/window`, { handle: mainHandle })
      }
    }
  } finally {
    await wdReq('DELETE', `/session/${sid}`).catch(() => {})
  }

  await new Promise(r => setTimeout(r, 1200))
  sid = await createSession()
  try {
    await waitForMounted(sid)
    const persisted = await wdInvoke(sid, 'settings_get')
    if (persisted.theme !== 'dark' || persisted.sidebarCollapsed !== true) {
      throw new Error(`Settings did not persist across restart: ${JSON.stringify(persisted)}`)
    }
    summary.restartPersisted = true
    summary.persistedRevision = persisted.revision
  } finally {
    await wdReq('DELETE', `/session/${sid}`).catch(() => {})
  }

  return summary
}

async function runMacosNative(bin, dataDir) {
  const summary = {
    mode: 'macos-native',
    dataDir,
    screenshots: [],
    note: 'WKWebView has no official WebDriver; verifies real native binary startup, isolated Rust data dir initialization, and screen capture attempt.',
  }
  const proc = spawn(bin, [], {
    cwd: tauriAppRoot,
    env: { ...process.env, BOXPLAYER_DEV_DATA_DIR: dataDir },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let logs = ''
  proc.stdout.on('data', d => {
    logs += d.toString()
  })
  proc.stderr.on('data', d => {
    logs += d.toString()
  })

  try {
    const deadline = Date.now() + 12000
    let initializedFiles = []
    while (Date.now() < deadline) {
      if (proc.exitCode !== null) {
        throw new Error(`macOS native binary exited early (${proc.exitCode}): ${logs}`)
      }
      initializedFiles = await listDirTree(dataDir)
      if (initializedFiles.length > 0) break
      await new Promise(r => setTimeout(r, 400))
    }
    if (proc.exitCode !== null) {
      throw new Error(`macOS native binary exited early (${proc.exitCode}): ${logs}`)
    }
    if (initializedFiles.length === 0) throw new Error(`macOS did not initialize its test data directory: ${logs}`)
    summary.initializedFiles = initializedFiles

    const screenFile = join(outDir, 'l2-native-macos-screen.png')
    const shot = spawnSync('screencapture', ['-x', screenFile], { encoding: 'utf-8' })
    if (shot.status === 0) {
      summary.screenshots.push('l2-native-macos-screen.png')
    } else {
      summary.screencaptureSkipped = (shot.stderr || `exit ${shot.status}`).trim()
    }
  } finally {
    await killProcess(proc)
  }
  return summary
}

async function main() {
  const mode = parseMode()
  const bin = binaryPath()
  await mkdir(outDir, { recursive: true })
  const dataDir = process.env.BOXPLAYER_DEV_DATA_DIR || (await mkdtemp(join(tmpdir(), 'bp-tauri-l2-')))
  await mkdir(dataDir, { recursive: true })

  const server = spawn(
    process.execPath,
    [viteBin, 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'],
    { cwd: tauriAppRoot, stdio: ['ignore', 'pipe', 'pipe'] },
  )

  let result
  try {
    await waitForHttp(`${BASE_URL}/index.html`, 30000)
    if (mode === 'windows-webdriver') result = await runNativeWebdriver(bin, dataDir, 'windows')
    else if (mode === 'linux-webdriver') result = await runNativeWebdriver(bin, dataDir, 'linux')
    else if (mode === 'macos-native') result = await runMacosNative(bin, dataDir)
    else throw new Error(`Unknown mode: ${mode}`)

    await writeFile(join(outDir, 'l2-summary.json'), JSON.stringify(result, null, 2), 'utf-8')
    console.log(`Tauri L2 native test (${mode}) passed -> ${outDir}`)
  } catch (err) {
    console.error(`Tauri L2 native test (${mode}) failed:`, err)
    process.exitCode = 1
  } finally {
    await killProcess(server)
    if (!process.env.BOXPLAYER_DEV_DATA_DIR) {
      await rm(dataDir, { recursive: true, force: true }).catch(() => {})
    }
  }
}

main()
