import { chromium, expect, test } from '@playwright/test'
import { spawn, execFileSync, type ChildProcess } from 'node:child_process'
import { existsSync, mkdtempSync } from 'node:fs'
import { connect } from 'node:net'
import os from 'node:os'
import path from 'node:path'

test.skip(process.platform !== 'win32', 'Windows x64 Electron playback regression')
test.setTimeout(90_000)

async function waitForPort(port: number): Promise<void> {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    const open = await new Promise<boolean>((resolve) => {
      const socket = connect(port, '127.0.0.1')
      socket.once('connect', () => { socket.destroy(); resolve(true) })
      socket.once('error', () => { socket.destroy(); resolve(false) })
    })
    if (open) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Electron DevTools port ${port} did not open`)
}

test('Windows production Electron displays embedded MPV software frames', async () => {
  const entry = path.resolve('dist/electron/main/index.js')
  if (!existsSync(entry)) throw new Error(`Missing production Electron entry: ${entry}`)
  const electronBinary = require('electron') as string
  const userData = mkdtempSync(path.join(os.tmpdir(), 'boxplayer-mpv-cdp-'))
  const port = 19222
  const electronProcess: ChildProcess = spawn(electronBinary, [`--remote-debugging-port=${port}`, entry], {
    env: {
      ...process.env,
      BOXPLAYER_E2E: '1',
      BOXPLAYER_E2E_TRANSFERS: '0',
      BOXPLAYER_E2E_PROJECT_PATH: process.cwd(),
      BOXPLAYER_E2E_USER_DATA: userData,
      CLOUDDRIVE_CLI_CONFIG_DIR: path.join(userData, '.clouddrive-cli')
    },
    stdio: 'ignore'
  })
  let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | undefined
  try {
    await waitForPort(port)
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
    const context = browser.contexts()[0]
    if (!context) throw new Error('Electron CDP browser has no context')
    const page = context.pages()[0] || await context.waitForEvent('page', { timeout: 20_000 })
    await page.waitForFunction(() => typeof window.WebMpvEmbeddedCapability === 'function')
    const capability = await page.evaluate(() => window.WebMpvEmbeddedCapability())
    expect(capability.enabled, capability.reason).toBe(true)

    await page.evaluate(() => {
      ;(window as any).__mpvVisibleFrame = false
      window.WebMpvSharedTexture.onSoftwareFrame((pixels, width, height) => {
        if (pixels.length !== width * height * 4) return
        const middle = (Math.floor(height / 2) * width + Math.floor(width / 2)) * 4
        if (pixels[middle + 3] === 255 && (pixels[middle] || pixels[middle + 1] || pixels[middle + 2])) {
          ;(window as any).__mpvVisibleFrame = true
        }
      })
    })
    const sample = path.resolve('e2e/assets/mpv-sample.mp4')
    const result = await page.evaluate((url) => window.WebMpvEmbeddedLoad({ url, title: 'Windows MPV E2E' }), sample)
    expect(result.ok, result.error).toBe(true)
    await expect.poll(async () => {
      const status = await page.evaluate(() => window.WebMpvEmbeddedStatus())
      return Boolean(status.ok && status.status?.duration > 0 && status.status?.position > 0)
    }, { timeout: 15_000 }).toBe(true)
    await expect.poll(() => page.evaluate(() => (window as any).__mpvVisibleFrame), { timeout: 15_000 }).toBe(true)
    const stop = await page.evaluate(() => window.WebMpvEmbeddedControl({ action: 'stop' }))
    expect(stop.ok, stop.error).toBe(true)
  } finally {
    if (electronProcess.pid) {
      try { execFileSync('taskkill', ['/PID', String(electronProcess.pid), '/T', '/F'], { stdio: 'ignore' }) } catch {}
    }
    await browser?.close().catch(() => undefined)
  }
})
