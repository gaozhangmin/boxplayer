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
const viteBin = require.resolve('vite/bin/vite.js', { paths: [tauriAppRoot] })

const PORT = 1428
const BASE_URL = `http://127.0.0.1:${PORT}`
const CDP_PORT = 9222
const WD_URL = process.env.TAURI_WEBDRIVER_URL || 'http://127.0.0.1:4444'

function parseMode() {
  const idx = process.argv.indexOf('--mode')
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1]
  if (process.platform === 'win32') return 'windows-cdp'
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
    proc.kill('SIGTERM')
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

async function runWindowsCdp(bin, dataDir) {
  const playwrightTarget = process.env.PLAYWRIGHT_MODULE_PATH || 'playwright'
  const { chromium } = require(playwrightTarget)
  const summary = { mode: 'windows-cdp', dataDir, windows: [], screenshots: [] }

  const launchApp = () =>
    spawn(bin, [], {
      cwd: tauriAppRoot,
      env: {
        ...process.env,
        BOXPLAYER_DEV_DATA_DIR: dataDir,
        WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${CDP_PORT}`,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

  let proc = launchApp()
  let browser
  try {
    await waitForHttp(`http://127.0.0.1:${CDP_PORT}/json/version`, 60000)
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`)

    const findPage = async (urlFragment, timeoutMs = 30000) => {
      const deadline = Date.now() + timeoutMs
      while (Date.now() < deadline) {
        for (const ctx of browser.contexts()) {
          for (const p of ctx.pages()) {
            if (p.url().includes(urlFragment)) return p
          }
        }
        await new Promise(r => setTimeout(r, 250))
      }
      throw new Error(`Timed out waiting for WebView2 page matching ${urlFragment}`)
    }

    const mainPage = await findPage('index.html', 45000)
    const pageErrors = []
    mainPage.on('pageerror', err => pageErrors.push(err.message || String(err)))
    await mainPage.waitForFunction(
      () => {
        const root = document.querySelector('#app')
        return Boolean(root && root.children.length > 0 && window.__TAURI_INTERNALS__)
      },
      { timeout: 30000 },
    )
    await mainPage.waitForTimeout(500)

    const runtimeInfo = await mainPage.evaluate(() =>
      window.__TAURI_INTERNALS__.invoke('runtime_info'),
    )
    if (runtimeInfo.platform !== 'windows') {
      throw new Error(`Expected platform windows, got ${runtimeInfo.platform}`)
    }
    summary.runtimeInfo = runtimeInfo

    await mainPage.screenshot({ path: join(outDir, 'l2-native-main-initial.png'), fullPage: true })
    summary.screenshots.push('l2-native-main-initial.png')

    const initialSettings = await mainPage.evaluate(() =>
      window.__TAURI_INTERNALS__.invoke('settings_get'),
    )
    const updatedSettings = await mainPage.evaluate(
      rev =>
        window.__TAURI_INTERNALS__.invoke('settings_update', {
          expectedRevision: rev,
          patch: { theme: 'dark', sidebarCollapsed: true },
        }),
      initialSettings.revision,
    )
    if (
      updatedSettings.revision !== initialSettings.revision + 1 ||
      updatedSettings.theme !== 'dark' ||
      updatedSettings.sidebarCollapsed !== true
    ) {
      throw new Error(`Unexpected updated settings: ${JSON.stringify(updatedSettings)}`)
    }
    await mainPage.waitForFunction(() => document.documentElement.classList.contains('dark'), {
      timeout: 10000,
    })
    await mainPage.waitForTimeout(300)
    await mainPage.screenshot({ path: join(outDir, 'l2-native-main-dark.png'), fullPage: true })
    summary.screenshots.push('l2-native-main-dark.png')

    const secondary = [
      { kind: 'settings', view: 'general', urlPart: 'settings.html', file: 'l2-native-settings.png' },
      { kind: 'sources', view: 'shares', urlPart: 'sources.html', file: 'l2-native-sources.png' },
      { kind: 'player', view: undefined, urlPart: 'player.html', file: 'l2-native-player.png' },
    ]
    for (const win of secondary) {
      await mainPage.evaluate(
        ({ kind, view }) => window.__TAURI_INTERNALS__.invoke('window_open', { kind, view }),
        { kind: win.kind, view: win.view },
      )
      const p = await findPage(win.urlPart, 30000)
      await p.waitForFunction(
        () => {
          const root = document.querySelector('#app')
          return Boolean(root && root.children.length > 0)
        },
        { timeout: 20000 },
      )
      await p.waitForTimeout(400)
      await p.screenshot({ path: join(outDir, win.file), fullPage: true })
      summary.windows.push(win.kind)
      summary.screenshots.push(win.file)
    }

    if (pageErrors.length > 0) {
      throw new Error(`Native WebView2 pageerror(s): ${pageErrors.join('; ')}`)
    }

    await browser.close()
    browser = undefined
    await killProcess(proc)
    await new Promise(r => setTimeout(r, 1000))

    // Restart persistence check with the exact same BOXPLAYER_DEV_DATA_DIR.
    proc = launchApp()
    await waitForHttp(`http://127.0.0.1:${CDP_PORT}/json/version`, 60000)
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`)
    const restartedMain = await findPage('index.html', 45000)
    await restartedMain.waitForFunction(() => Boolean(window.__TAURI_INTERNALS__), {
      timeout: 30000,
    })
    const persisted = await restartedMain.evaluate(() =>
      window.__TAURI_INTERNALS__.invoke('settings_get'),
    )
    if (persisted.theme !== 'dark' || persisted.sidebarCollapsed !== true) {
      throw new Error(`Settings did not persist across restart: ${JSON.stringify(persisted)}`)
    }
    summary.restartPersisted = true
    summary.persistedRevision = persisted.revision
  } finally {
    if (browser) await browser.close().catch(() => {})
    await killProcess(proc)
  }
  return summary
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

async function runLinuxWebdriver(bin, dataDir) {
  const summary = { mode: 'linux-webdriver', dataDir, windows: [], screenshots: [] }
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
    throw new Error('Timed out waiting for #app + __TAURI_INTERNALS__ in WebKitGTK')
  }

  let sid = await createSession()
  try {
    await waitForMounted(sid)
    await new Promise(r => setTimeout(r, 500))

    const runtimeInfo = await wdInvoke(sid, 'runtime_info')
    if (runtimeInfo.platform !== 'linux') {
      throw new Error(`Expected platform linux, got ${runtimeInfo.platform}`)
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
      await new Promise(r => setTimeout(r, 1000))
      const handles = await wdReq('GET', `/session/${sid}/window/handles`)
      const newHandle = handles.find(h => !knownHandles.has(h))
      if (newHandle) {
        knownHandles = new Set(handles)
        await wdReq('POST', `/session/${sid}/window`, { handle: newHandle })
        await new Promise(r => setTimeout(r, 600))
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
    if (mode === 'windows-cdp') result = await runWindowsCdp(bin, dataDir)
    else if (mode === 'linux-webdriver') result = await runLinuxWebdriver(bin, dataDir)
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
