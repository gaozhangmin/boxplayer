import { _electron as electron, test as base, type ElectronApplication, type Page } from '@playwright/test'
import { spawn, type ChildProcess } from 'child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { connect } from 'net'
import os from 'os'
import path from 'path'
// The parser is shared with the release-workflow preflight and intentionally
// remains plain CommonJS so it can run before Electron or TypeScript is built.
// @ts-expect-error JavaScript helper uses runtime validation.
import { parseRealCloudAccounts } from '../../scripts/real-cloud-e2e-config.cjs'
// @ts-expect-error CommonJS helper is shared with Actions preflight.
import { resolveRealMediaServerE2EConfig } from '../../scripts/real-media-server-e2e-config.cjs'

export interface RealMediaServerFixture {
  name: string
  baseUrl: string
  mediaTitle: string
}

export interface BoxPlayerFixture {
  app: ElectronApplication
  page: Page
  pageErrors: string[]
  consoleErrors: string[]
  mediaServer?: RealMediaServerFixture
}

function sanitizeConsoleText(value: string): string {
  return value
    .replace(/([?&](?:access_token|refresh_token|provider_token|provider_refresh_token|api_key|apikey|key|token|x-oss-signature|x-amz-signature|x-amz-credential)=)[^&#\s)]+/gi, '$1[redacted]')
    .replace(/(["']?(?:access_token|refresh_token|provider_token|provider_refresh_token|authorization|cookie|set-cookie|signature)["']?\s*:\s*["'])[^"'\r\n]+(["'])/gi, '$1[redacted]$2')
    .replace(/((?:authorization|cookie|set-cookie|x-emby-token)\s*[=:]\s*)[^\r\n}]+/gi, '$1[redacted]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
}

function isRealCloudTest(file: string): boolean {
  return /^real(?:Cloud|MediaServer).*\.spec\.ts$/i.test(path.basename(file))
}

function isRealCloudProviderTest(file: string): boolean {
  return /^realCloud.*\.spec\.ts$/i.test(path.basename(file))
}

function isRealMediaServerTest(file: string): boolean {
  return /^realMediaServer.*\.spec\.ts$/i.test(path.basename(file))
}

function defaultRealProfilePath(): string {
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library/Application Support/BoxPlayer')
  if (process.platform === 'win32') return path.join(process.env.APPDATA || '', 'BoxPlayer')
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'BoxPlayer')
}

function copyRealProfile(target: string, enabled: boolean): void {
  if (!enabled) return
  const source = process.env.BOXPLAYER_E2E_REAL_USER_DATA || defaultRealProfilePath()
  if (!existsSync(source)) throw new Error(`BoxPlayer real profile is missing: ${source}`)

  for (const relative of ['IndexedDB/file__0.indexeddb.leveldb', 'IndexedDB/http_localhost_5173.indexeddb.leveldb', 'IndexedDB/http_127.0.0.1_5173.indexeddb.leveldb', 'Local Storage/leveldb', 'setting.config']) {
    const sourcePath = path.join(source, relative)
    if (!existsSync(sourcePath)) continue
    const targetPath = path.join(target, relative)
    mkdirSync(path.dirname(targetPath), { recursive: true })
    cpSync(sourcePath, targetPath, { recursive: true })
  }
  rmSync(path.join(target, 'IndexedDB/file__0.indexeddb.leveldb/LOCK'), { force: true })
  rmSync(path.join(target, 'Local Storage/leveldb/LOCK'), { force: true })
  const settingPath = path.join(target, 'setting.config')
  if (existsSync(settingPath)) {
    const setting = JSON.parse(readFileSync(settingPath, 'utf8'))
    const downloadPath = path.join(target, 'E2E Downloads')
    mkdirSync(downloadPath, { recursive: true })
    setting.downSavePath = downloadPath
    setting.downSavePathDefault = true
    setting.AriaIsLocal = true
    writeFileSync(settingPath, JSON.stringify(setting))
  }
}

function configureRealCloudMpv(userData: string): void {
  if (process.env.BOXPLAYER_E2E_REAL_MPV !== '1') return
  const settingPath = path.join(userData, 'setting.config')
  let setting: Record<string, unknown> = {}
  if (existsSync(settingPath)) {
    try { setting = JSON.parse(readFileSync(settingPath, 'utf8')) } catch {}
  }
  setting.uiVideoPlayer = 'mpv'
  setting.uiVideoSubtitleMode = 'close'
  writeFileSync(settingPath, JSON.stringify(setting))
}

async function seedRealCloudAccounts(page: Page, provider?: string): Promise<void> {
  const value = process.env.BOXPLAYER_E2E_ACCOUNTS_JSON
  if (!value?.trim()) return
  const parsedAccounts = parseRealCloudAccounts(value)
  // The main drive view bootstraps most reliably from the Aliyun account. Keep
  // it as a stable anchor, then inject only the provider under test so unrelated
  // OAuth refreshes cannot invalidate another provider's rotating token.
  const accounts = provider ? parsedAccounts.filter(account => account.tokenfrom === 'aliyun' || account.tokenfrom === provider) : parsedAccounts
  if (!accounts.length) throw new Error(`Injected real-cloud account list has no account for ${provider}`)
  const defaultUserId = accounts.find(account => account.tokenfrom === 'aliyun')?.user_id || accounts[0]?.user_id
  if (!defaultUserId) throw new Error('Injected real-cloud account list has no default user')
  await page.waitForFunction(() => typeof window.WebE2ESeedCloudAccounts === 'function', undefined, { timeout: 45_000 })
  await page.evaluate(async ({ accounts, defaultUserId }) => {
    if (!window.WebE2ESeedCloudAccounts) throw new Error('BoxPlayer E2E account seeding hook is unavailable')
    await window.WebE2ESeedCloudAccounts(accounts, defaultUserId)
  }, { accounts, defaultUserId })
  await page.reload()
  await page.waitForLoadState('domcontentloaded')
}

async function seedRealMediaServer(page: Page): Promise<RealMediaServerFixture | undefined> {
  if (!process.env.BOXPLAYER_E2E_EMBY_JSON?.trim()) return undefined
  const config = await resolveRealMediaServerE2EConfig()
  const now = Date.now()
  await page.evaluate(({ config, now }) => {
    const server = {
      id: 'media_server_e2e_emby',
      type: 'emby',
      name: config.name,
      baseUrl: config.baseUrl,
      accessToken: config.accessToken,
      userId: config.userId,
      deviceId: config.deviceId,
      loginStatus: 'success',
      createdAt: now,
      updatedAt: now,
      lastUsedAt: now
    }
    localStorage.setItem('MediaServer_Registry', JSON.stringify([server]))
    localStorage.setItem('MediaServer_Preferences', JSON.stringify({
      currentServerId: server.id,
      serverListView: 'grid',
      serverSortBy: 'lastUsedAt',
      serverSortOrder: 'desc',
      serverSearchText: '',
      pinnedServerIds: []
    }))
  }, { config, now })
  await page.reload()
  await page.waitForLoadState('domcontentloaded')
  await page.waitForFunction((serverName) => {
    try {
      const servers = JSON.parse(localStorage.getItem('MediaServer_Registry') || '[]')
      return Array.isArray(servers) && servers.some((server) => server?.name === serverName)
    } catch {
      return false
    }
  }, config.name, { timeout: 30_000 })
  return { name: config.name, baseUrl: config.baseUrl, mediaTitle: config.mediaTitle }
}

async function waitForPort(port: number, timeout = 10_000): Promise<void> {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const connected = await new Promise<boolean>((resolve) => {
      const socket = connect({ host: '127.0.0.1', port })
      socket.once('connect', () => { socket.destroy(); resolve(true) })
      socket.once('error', () => { socket.destroy(); resolve(false) })
    })
    if (connected) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Timed out waiting for the test service on port ${port}`)
}

async function isPortOpen(port: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const socket = connect({ host: '127.0.0.1', port })
    socket.once('connect', () => { socket.destroy(); resolve(true) })
    socket.once('error', () => { socket.destroy(); resolve(false) })
  })
}

async function startRealAccountRenderer(): Promise<ChildProcess | undefined> {
  if (await isPortOpen(5173)) return undefined
  const viteCli = path.resolve('node_modules/vite/bin/vite.js')
  if (!existsSync(viteCli)) throw new Error(`Vite CLI is missing: ${viteCli}`)
  // Execute Vite with Node directly. This avoids .cmd/shell process trees on
  // Windows and lets every isolated provider test stop the preview cleanly.
  const child = spawn(process.execPath, [viteCli, 'preview', '--host', '127.0.0.1', '--port', '5173', '--strictPort'], {
    cwd: process.cwd(),
    stdio: 'ignore',
    windowsHide: true
  })
  await waitForPort(5173)
  return child
}

async function stopChildProcess(child?: ChildProcess): Promise<void> {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))
  child.kill()
  await Promise.race([exited, new Promise<void>((resolve) => setTimeout(resolve, 5_000))])
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
}

async function startIsolatedAria(userData: string): Promise<ChildProcess> {
  const executable = process.platform === 'win32' ? 'aria2c.exe' : 'aria2c'
  const binary = path.resolve('static/engine', process.platform, process.arch, executable)
  const config = path.resolve('static/engine', process.platform, process.arch, 'aria2.conf')
  if (!existsSync(binary) || !existsSync(config)) throw new Error(`Aria2 E2E runtime is missing for ${process.platform}/${process.arch}`)
  const child = spawn(binary, [
    `--conf-path=${config}`,
    '--rpc-listen-port=16800',
    '--rpc-secret=S4znWTaZYQi3cpRNb',
    `--dir=${path.join(userData, 'E2E Downloads')}`,
    `--save-session=${path.join(userData, 'download.session')}`,
    '--pause=true'
  ], { stdio: 'ignore' })
  await waitForPort(16800)
  return child
}

export const test = base.extend<{ boxPlayer: BoxPlayerFixture }, { realAccountRenderer?: ChildProcess }>({
  realAccountRenderer: [async ({}, use) => {
    const enabled = Boolean(process.env.BOXPLAYER_E2E_ACCOUNTS_JSON?.trim() || process.env.BOXPLAYER_E2E_EMBY_JSON?.trim())
    const renderer = enabled ? await startRealAccountRenderer() : undefined
    try {
      await use(renderer)
    } finally {
      await stopChildProcess(renderer)
    }
  }, { scope: 'worker' }],
  boxPlayer: async ({ realAccountRenderer: _realAccountRenderer }, use, testInfo) => {
    const entry = path.resolve('dist/electron/main/index.js')
    if (!existsSync(entry)) throw new Error(`Electron production entry is missing: ${entry}`)

    const userData = mkdtempSync(path.join(os.tmpdir(), 'boxplayer-e2e-'))
    const realAccountTest = isRealCloudTest(testInfo.file)
    const injectedRealAccounts = isRealCloudProviderTest(testInfo.file) && Boolean(process.env.BOXPLAYER_E2E_ACCOUNTS_JSON?.trim())
    const injectedRealMediaServer = isRealMediaServerTest(testInfo.file) && Boolean(process.env.BOXPLAYER_E2E_EMBY_JSON?.trim())
    const cloudProvider = testInfo.annotations.find(annotation => annotation.type === 'cloud-provider')?.description
    copyRealProfile(userData, (realAccountTest || process.env.BOXPLAYER_E2E_REAL === '1') && !injectedRealAccounts && !injectedRealMediaServer)
    if (realAccountTest) configureRealCloudMpv(userData)
    if (path.basename(testInfo.file) === 'embeddedMpvPlayback.spec.ts') {
      writeFileSync(path.join(userData, 'setting.config'), JSON.stringify({ uiVideoPlayer: 'mpv', uiVideoSubtitleMode: 'close' }))
    }
    let ariaProcess: ChildProcess | undefined
    if (realAccountTest) ariaProcess = await startIsolatedAria(userData)
    const app = await electron.launch({
      args: [entry],
      env: {
        ...process.env,
        BOXPLAYER_E2E: '1',
        BOXPLAYER_E2E_TRANSFERS: '0',
        BOXPLAYER_E2E_PROJECT_PATH: process.cwd(),
        BOXPLAYER_E2E_USER_DATA: userData,
        CLOUDDRIVE_CLI_CONFIG_DIR: path.join(userData, '.clouddrive-cli'),
        BOXPLAYER_E2E_RENDERER_URL: realAccountTest ? 'http://localhost:5173' : ''
      }
    })

    try {
      const page = await app.firstWindow()
      await page.waitForLoadState('domcontentloaded')
      if (realAccountTest && injectedRealAccounts) await seedRealCloudAccounts(page, cloudProvider)
      const mediaServer = injectedRealMediaServer ? await seedRealMediaServer(page) : undefined
      const pageErrors: string[] = []
      const consoleErrors: string[] = []
      page.on('pageerror', (error) => pageErrors.push(sanitizeConsoleText(error.message)))
      page.on('console', (message) => {
        const text = sanitizeConsoleText(message.text())
        const expectedMissingAria = text.includes("WebSocket connection to 'ws://127.0.0.1:16800/jsonrpc' failed")
        const location = sanitizeConsoleText(message.location().url)
        if (message.type() === 'error' && !expectedMissingAria) consoleErrors.push(location ? `${text} (${location})` : text)
      })
      if (injectedRealAccounts) {
        await page.locator('.user-avatar-trigger').waitFor({ state: 'visible', timeout: 45_000 })
        // The copied profile may contain pending transfers targeting the user's real disk.
        // Clear only transfer databases in this isolated profile before enabling workers.
        await page.evaluate(async () => {
          for (const name of ['XBYDB3Down', 'XBYDB3Upload']) {
            await new Promise<void>((resolve, reject) => {
              const request = indexedDB.open(name)
              request.onerror = () => reject(request.error)
              request.onsuccess = () => {
                const db = request.result
                const stores = Array.from(db.objectStoreNames)
                if (!stores.length) { db.close(); resolve(); return }
                const tx = db.transaction(stores, 'readwrite')
                for (const store of stores) tx.objectStore(store).clear()
                tx.oncomplete = () => { db.close(); resolve() }
                tx.onabort = () => { db.close(); reject(tx.error) }
              }
            })
          }
        })
        await page.reload()
        await page.waitForLoadState('domcontentloaded')
        await page.evaluate(() => { window.WebE2EAllowTransfers = true })
      }
      const loginDialog = page.locator('.userloginmodal')
      await loginDialog.waitFor({ state: 'visible', timeout: 3_000 }).catch(() => undefined)
      if (await loginDialog.isVisible()) await loginDialog.getByRole('button', { name: 'Close' }).click()
      await use({ app, page, pageErrors, consoleErrors, mediaServer })
      if (testInfo.status !== testInfo.expectedStatus) {
        await testInfo.attach('renderer-errors', { body: JSON.stringify({ url: page.url(), pageErrors, consoleErrors }), contentType: 'application/json' })
      }
    } finally {
      // If Electron has already crashed, Playwright disposes the application
      // handle and process() itself throws. Keep the original playback failure
      // instead of replacing it with an internal disposed-handle error.
      let electronProcess: ChildProcess | undefined
      try { electronProcess = app.process() } catch {}
      if (path.basename(testInfo.file).startsWith('embeddedMpv')) {
        // BoxPlayer's window-close handler can hide to tray. Quit the app
        // explicitly so MPV receives will-quit and its native threads stop.
        // Remove only the test process' window close interception first;
        // otherwise app.quit() is cancelled on Windows, the forced kill leaves
        // Chromium profile files locked, and Playwright's worker cannot tear
        // down even though every playback assertion already passed.
        // Do not race app.close(): the abandoned close promise retains the
        // Playwright transport and makes an otherwise-passing worker time out.
        await app.evaluate(({ app: electronApp, BrowserWindow }) => {
          for (const window of BrowserWindow.getAllWindows()) window.removeAllListeners('close')
          electronApp.quit()
        }).catch(() => undefined)
        if (electronProcess && electronProcess.exitCode === null && electronProcess.signalCode === null) {
          await Promise.race([
            new Promise<void>((resolve) => electronProcess.once('exit', () => resolve())),
            new Promise<void>((resolve) => setTimeout(resolve, 5_000))
          ])
        }
      } else {
        await Promise.race([
          app.close(),
          new Promise<void>((resolve) => setTimeout(resolve, 5_000))
        ])
      }
      if (electronProcess && electronProcess.exitCode === null && !electronProcess.killed) {
        electronProcess.kill('SIGKILL')
        await Promise.race([
          new Promise<void>((resolve) => electronProcess.once('exit', () => resolve())),
          new Promise<void>((resolve) => setTimeout(resolve, 5_000))
        ])
      }
      await stopChildProcess(ariaProcess)
      try {
        rmSync(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
      } catch (error) {
        // Windows can retain Chromium cache handles after Electron exits.
        // A cleanup failure must not hide the playback assertion that failed.
        console.warn(`Could not remove isolated E2E profile ${userData}:`, error)
      }
    }
  }
})

export { expect } from '@playwright/test'
