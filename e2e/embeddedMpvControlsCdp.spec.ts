import { chromium, expect, test, type Page } from '@playwright/test'
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { connect } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

test.skip(!['win32', 'linux'].includes(process.platform), 'Embedded MPV controls target Windows and Linux')
test.setTimeout(120_000)

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

async function setRange(page: Page, locator: ReturnType<Page['locator']>, value: number): Promise<void> {
  await locator.evaluate((element, nextValue) => {
    const input = element as HTMLInputElement
    input.value = String(nextValue)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }, value)
}

test('all visible MPV player controls execute successfully', async () => {
  const entry = path.resolve('dist/electron/main/index.js')
  if (!existsSync(entry)) throw new Error(`Missing production Electron entry: ${entry}`)
  const electronBinary = require('electron') as string
  const userData = mkdtempSync(path.join(os.tmpdir(), 'boxplayer-mpv-controls-'))
  writeFileSync(path.join(userData, 'setting.config'), JSON.stringify({ uiVideoPlayer: 'mpv', uiVideoSubtitleMode: 'close' }))
  const port = 19223
  const args = [`--remote-debugging-port=${port}`, ...(process.platform === 'linux' ? ['--no-sandbox'] : []), entry]
  const electronProcess: ChildProcess = spawn(electronBinary, args, {
    env: { ...process.env, BOXPLAYER_E2E: '1', BOXPLAYER_E2E_TRANSFERS: '0', BOXPLAYER_E2E_PROJECT_PATH: process.cwd(), BOXPLAYER_E2E_USER_DATA: userData },
    stdio: 'ignore'
  })
  let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | undefined
  try {
    await waitForPort(port)
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
    const context = browser.contexts()[0]
    const mainPage = context.pages()[0] || await context.waitForEvent('page')
    await mainPage.waitForFunction(() => typeof window.WebOpenWindow === 'function')
    const videoPath = path.resolve('e2e/assets/mpv-sample.mp4')
    const parentPath = path.dirname(videoPath)
    const subtitlePath = path.resolve('e2e/assets/mpv-sample.srt')
    const subtitleUrl = pathToFileURL(subtitlePath).href
    const playerPromise = context.waitForEvent('page')
    await mainPage.evaluate(({ videoPath, parentPath, subtitleUrl }) => window.WebOpenWindow({
      page: 'PageVideo',
      theme: 'dark',
      data: {
        user_id: 'e2e', tokenfrom: 'local', drive_id: 'local', file_id: videoPath,
        parent_file_id: parentPath, parent_file_name: 'assets', file_name: 'mpv-sample.mp4', html: 'MPV controls E2E',
        encType: '', password: '', expire_time: 0, play_cursor: 0,
        media_subtitle_sources: [{ url: subtitleUrl, title: 'E2E subtitle' }],
        custom_playlist: [{ user_id: 'e2e', drive_id: 'local', file_id: videoPath, parent_file_id: parentPath, file_name: 'mpv-sample.mp4', html: 'MPV sample' }]
      }
    }), { videoPath, parentPath, subtitleUrl })
    const player = await playerPromise
    await player.waitForSelector('#mpvEmbeddedPlayer.mpv-embedded-surface', { timeout: 30_000 })
    await player.evaluate(({ externalAudioPath, externalSubtitlePath }) => {
      ;(window as any).__mpvControlLog = []
      const original = window.WebMpvEmbeddedControl
      window.WebMpvEmbeddedControl = async (request) => {
        const result = await original(request)
        ;(window as any).__mpvControlLog.push({ request, result })
        return result
      }
      window.WebShowOpenDialogSync = (options, callback) => callback([String(options?.title || '').includes('音频') ? externalAudioPath : externalSubtitlePath])
    }, { externalAudioPath: videoPath, externalSubtitlePath: subtitlePath })
    const surface = player.locator('#mpvEmbeddedPlayer')
    await surface.hover()

    await player.getByRole('button', { name: '暂停' }).click()
    await expect(player.getByRole('button', { name: '播放' })).toBeVisible()
    await player.getByRole('button', { name: '播放' }).click()
    await setRange(player, player.getByRole('slider', { name: '播放进度' }), 1)
    await setRange(player, player.getByRole('slider', { name: '音量' }), 35)

    const playlistToggle = player.locator('.mpv-transport-buttons button[aria-label="播放列表"]')
    if (!(await playlistToggle.getAttribute('class'))?.includes('active')) await playlistToggle.click()
    const playlistTabs = player.locator('.mpv-playlist-tabs')
    await expect(playlistTabs.getByRole('button', { name: '章节' })).toBeVisible()
    await playlistTabs.getByRole('button', { name: '章节' }).click()
    await playlistTabs.getByRole('button', { name: '播放列表' }).click()
    await playlistToggle.click()

    await player.getByRole('button', { name: '设置片头' }).click()
    await player.getByRole('button', { name: '设置片尾' }).click()
    await player.getByRole('button', { name: '设置', exact: true }).click()
    await player.getByRole('button', { name: '16:9' }).first().click()
    await player.getByRole('button', { name: '16:10' }).nth(1).click()
    await player.getByRole('button', { name: '90°' }).click()
    await player.getByRole('combobox', { name: '倍速' }).selectOption('1.5')
    for (const label of ['硬件解码', '反交错', 'HDR 色调映射']) await player.getByText(label, { exact: true }).locator('..').getByRole('checkbox').click()
    const videoSection = player.locator('.mpv-side-settings-content').filter({ hasText: '均衡器' })
    await setRange(player, videoSection.locator('.mpv-video-filter-row input').first(), 10)

    await player.getByRole('button', { name: '音频', exact: true }).click()
    await player.getByRole('button', { name: '加载外置音频…' }).click()
    const audioSelect = player.locator('select[title="音轨"]')
    await expect.poll(() => audioSelect.locator('option').count(), { timeout: 10_000 }).toBeGreaterThan(1)
    const audioValues = await audioSelect.locator('option').evaluateAll((items) => items.map((item) => (item as HTMLOptionElement).value))
    await audioSelect.selectOption(audioValues.find((value) => value !== '-1')!)
    const audioContent = player.locator('.mpv-side-settings-content')
    await setRange(player, audioContent.locator('.mpv-side-slider input').first(), 0.2)
    await setRange(player, audioContent.locator('.mpv-equalizer-band input').first(), 2)

    await player.getByRole('button', { name: '字幕', exact: true }).click()
    await player.getByRole('button', { name: '加载字幕…' }).click()
    const subtitleSelect = player.locator('select[title="字幕"]')
    await expect.poll(() => subtitleSelect.locator('option').count()).toBeGreaterThan(1)
    const subtitleValues = await subtitleSelect.locator('option').evaluateAll((items) => items.map((item) => (item as HTMLOptionElement).value))
    const enabledSubtitle = subtitleValues.find((value) => value !== 'track:-1')!
    await subtitleSelect.selectOption(enabledSubtitle)
    await player.locator('select[title="副字幕"]').selectOption(enabledSubtitle)
    const subtitleContent = player.locator('.mpv-side-settings-content')
    const subtitleRanges = subtitleContent.locator('.mpv-side-slider input[type="range"]')
    for (const [index, value] of [0.2, 80, 1.1, 48, 4].entries()) await setRange(player, subtitleRanges.nth(index), value)
    await subtitleContent.locator('label').filter({ hasText: '粗体' }).getByRole('checkbox').click()
    await subtitleContent.locator('label').filter({ hasText: '斜体' }).getByRole('checkbox').click()
    for (const [label, value] of [['字幕颜色', '#ffff00'], ['描边颜色', '#111111'], ['背景颜色', '#222222']] as const) {
      await subtitleContent.getByLabel(label).evaluate((element, nextValue) => {
        const input = element as HTMLInputElement
        input.value = nextValue
        input.dispatchEvent(new Event('change', { bubbles: true }))
      }, value)
    }
    await subtitleContent.getByRole('button', { name: '在线查找' }).click()
    await expect(player.getByText('在线字幕搜索')).toBeVisible()
    await player.locator('.mpv-subtitle-modal-close').click()

    const log = await player.evaluate(() => (window as any).__mpvControlLog)
    const actions = log.map((entry: any) => entry.request.action)
    for (const action of ['pause', 'play', 'seek', 'setVolume', 'setSpeed', 'addAudio', 'setAudioTrack', 'addSubtitle', 'setSubtitleTrack', 'setSubtitleStyle', 'setVideoProperty']) expect(actions).toContain(action)
    const failures = log.filter((entry: any) => !entry.result?.ok)
    expect(failures, JSON.stringify(failures, null, 2)).toEqual([])
    await expect(surface.locator('.mpv-embedded-error')).toHaveCount(0)
  } finally {
    if (electronProcess.pid) {
      if (process.platform === 'win32') {
        try { execFileSync('taskkill', ['/PID', String(electronProcess.pid), '/T', '/F'], { stdio: 'ignore' }) } catch {}
      } else electronProcess.kill('SIGKILL')
    }
    await browser?.close().catch(() => undefined)
  }
})
