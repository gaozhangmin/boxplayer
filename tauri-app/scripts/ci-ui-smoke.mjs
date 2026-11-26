import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const tauriAppRoot = resolve(scriptDir, '..')
const outDir = resolve(
  process.env.BOXPLAYER_UI_OUT_DIR || join(tauriAppRoot, '.local', 'ci-ui-screenshots'),
)

const require = createRequire(import.meta.url)
const playwrightTarget = process.env.PLAYWRIGHT_MODULE_PATH || 'playwright'
const { chromium } = require(playwrightTarget)
const viteBin = require.resolve('vite/bin/vite.js', { paths: [tauriAppRoot] })

const PORT = 1428
const BASE_URL = `http://127.0.0.1:${PORT}`
const ENTRIES = [
  { pagePath: 'index.html', screenshot: 'main.png' },
  { pagePath: 'settings.html', screenshot: 'settings.png' },
  { pagePath: 'player.html', screenshot: 'player.png' },
  { pagePath: 'sources.html', screenshot: 'sources.png' },
  { pagePath: 'media.html', screenshot: 'media.png' },
]

async function waitForServer(url, timeoutMs = 30000) {
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
  throw new Error(`Timed out waiting for preview server at ${url}`)
}

async function main() {
  await mkdir(outDir, { recursive: true })
  const server = spawn(
    process.execPath,
    [viteBin, 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'],
    { cwd: tauriAppRoot, stdio: ['ignore', 'pipe', 'pipe'] },
  )

  let serverLogs = ''
  server.stdout.on('data', chunk => {
    serverLogs += chunk.toString()
  })
  server.stderr.on('data', chunk => {
    serverLogs += chunk.toString()
  })

  let browser
  const results = []
  try {
    await waitForServer(`${BASE_URL}/index.html`)
    browser = await chromium.launch({ headless: true })
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })

    for (const entry of ENTRIES) {
      const page = await context.newPage()
      const pageErrors = []
      const badResponses = []

      page.on('pageerror', err => {
        pageErrors.push(err.message || String(err))
      })
      page.on('response', resp => {
        const respUrl = resp.url()
        if (respUrl.startsWith(BASE_URL) && resp.status() >= 400) {
          badResponses.push({ url: respUrl, status: resp.status() })
        }
      })

      const targetUrl = `${BASE_URL}/${entry.pagePath}`
      const response = await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 30000 })
      const status = response ? response.status() : 0
      await page.waitForTimeout(500)

      const appCheck = await page.evaluate(() => {
        const root = document.querySelector('#app')
        return {
          exists: Boolean(root),
          childCount: root ? root.children.length : 0,
          htmlLength: root ? root.innerHTML.trim().length : 0,
          title: document.title,
        }
      })

      const screenshotPath = join(outDir, entry.screenshot)
      await page.screenshot({ path: screenshotPath, fullPage: true })
      await page.close()

      if (status !== 200) {
        throw new Error(`${entry.pagePath}: expected HTTP 200, got ${status}`)
      }
      if (!appCheck.exists || (appCheck.childCount === 0 && appCheck.htmlLength === 0)) {
        throw new Error(`${entry.pagePath}: #app failed to mount`)
      }
      if (pageErrors.length > 0) {
        throw new Error(`${entry.pagePath}: uncaught page errors: ${pageErrors.join('; ')}`)
      }
      if (badResponses.length > 0) {
        throw new Error(`${entry.pagePath}: failed local asset responses: ${JSON.stringify(badResponses)}`)
      }

      results.push({
        pagePath: entry.pagePath,
        status,
        screenshot: entry.screenshot,
        appCheck,
      })
    }

    await writeFile(
      join(outDir, 'summary.json'),
      JSON.stringify({ baseUrl: BASE_URL, entries: results }, null, 2),
      'utf-8',
    )
    console.log(`Tauri UI smoke passed for ${results.length} entries -> ${outDir}`)
  } catch (err) {
    console.error('Tauri UI smoke failed:', err)
    if (serverLogs) {
      console.error('Preview server output:\n', serverLogs)
    }
    process.exitCode = 1
  } finally {
    if (browser) {
      await browser.close().catch(() => {})
    }
    if (!server.killed) {
      server.kill('SIGTERM')
    }
  }
}

main()
