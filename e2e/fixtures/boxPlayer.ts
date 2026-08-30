import { _electron as electron, test as base, type ElectronApplication, type Page } from '@playwright/test'
import { spawn, type ChildProcess } from 'child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { connect } from 'net'
import os from 'os'
import path from 'path'

export interface BoxPlayerFixture {
  app: ElectronApplication
  page: Page
  pageErrors: string[]
  consoleErrors: string[]
}

function sanitizeConsoleText(value: string): string {
  return value.replace(/([?&](?:access_token|api_key|apikey|key|token)=)[^&\s)]+/gi, '$1[redacted]')
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

  for (const relative of ['IndexedDB/file__0.indexeddb.leveldb', 'Local Storage/leveldb', 'setting.config']) {
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
  throw new Error(`Timed out waiting for the isolated Aria2 process on port ${port}`)
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

export const test = base.extend<{ boxPlayer: BoxPlayerFixture }>({
  boxPlayer: async ({}, use, testInfo) => {
    const entry = path.resolve('dist/electron/main/index.js')
    if (!existsSync(entry)) throw new Error(`Electron production entry is missing: ${entry}`)

    const userData = mkdtempSync(path.join(os.tmpdir(), 'boxplayer-e2e-'))
    const realAccountTest = path.basename(testInfo.file) === 'realCloud.spec.ts'
    copyRealProfile(userData, realAccountTest || process.env.BOXPLAYER_E2E_REAL === '1')
    let ariaProcess: ChildProcess | undefined
    if (realAccountTest) ariaProcess = await startIsolatedAria(userData)
    const app = await electron.launch({
      args: [entry],
      env: {
        ...process.env,
        BOXPLAYER_E2E: '1',
        BOXPLAYER_E2E_TRANSFERS: realAccountTest ? '1' : '0',
        BOXPLAYER_E2E_PROJECT_PATH: process.cwd(),
        BOXPLAYER_E2E_USER_DATA: userData
      }
    })

    try {
      const page = await app.firstWindow()
      const pageErrors: string[] = []
      const consoleErrors: string[] = []
      page.on('pageerror', (error) => pageErrors.push(error.message))
      page.on('console', (message) => {
        const text = sanitizeConsoleText(message.text())
        const expectedMissingAria = text.includes("WebSocket connection to 'ws://127.0.0.1:16800/jsonrpc' failed")
        const location = sanitizeConsoleText(message.location().url)
        if (message.type() === 'error' && !expectedMissingAria) consoleErrors.push(location ? `${text} (${location})` : text)
      })
      await page.waitForLoadState('domcontentloaded')
      const loginDialog = page.locator('.userloginmodal')
      await loginDialog.waitFor({ state: 'visible', timeout: 3_000 }).catch(() => undefined)
      if (await loginDialog.isVisible()) await loginDialog.getByRole('button', { name: 'Close' }).click()
      await use({ app, page, pageErrors, consoleErrors })
    } finally {
      await app.close()
      ariaProcess?.kill()
      rmSync(userData, { recursive: true, force: true })
    }
  }
})

export { expect } from '@playwright/test'
