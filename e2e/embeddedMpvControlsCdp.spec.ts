import { chromium, expect, test, type Page } from '@playwright/test'
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { connect } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

test.skip(!['darwin', 'win32', 'linux'].includes(process.platform), 'Embedded MPV controls require a desktop host')
test.setTimeout(180_000)

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

test('all visible MPV player controls execute successfully', async ({}, testInfo) => {
  const entry = path.resolve('dist/electron/main/index.js')
  if (!existsSync(entry)) throw new Error(`Missing production Electron entry: ${entry}`)
  const electronBinary = require('electron') as string
  const userData = mkdtempSync(path.join(os.tmpdir(), 'boxplayer-mpv-controls-'))
  writeFileSync(path.join(userData, 'setting.config'), JSON.stringify({ uiVideoPlayer: 'mpv', uiVideoSubtitleMode: 'close', uiLanguage: 'zh-CN' }))
  // A timed-out Electron process may hold its DevTools socket briefly. Give
  // every Playwright retry a separate port so the retry never attaches to the
  // previous process.
  const port = 19223 + testInfo.retry
  const args = [`--remote-debugging-port=${port}`, ...(process.platform === 'linux' ? ['--no-sandbox'] : []), entry]
  let electronOutput = ''
  const electronProcess: ChildProcess = spawn(electronBinary, args, {
    env: { ...process.env, BOXPLAYER_E2E: '1', BOXPLAYER_E2E_TRANSFERS: '0', BOXPLAYER_E2E_PROJECT_PATH: process.cwd(), BOXPLAYER_E2E_USER_DATA: userData, CLOUDDRIVE_CLI_CONFIG_DIR: path.join(userData, '.clouddrive-cli') },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  const recordOutput = (chunk: Buffer) => {
    electronOutput = `${electronOutput}${chunk.toString()}`.slice(-64 * 1024)
  }
  electronProcess.stdout?.on('data', recordOutput)
  electronProcess.stderr?.on('data', recordOutput)
  let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | undefined
  let stage = 'connecting to Electron'
  const markStage = (value: string) => {
    stage = value
    console.info(`[MPV controls] ${value}`)
  }
  try {
    await waitForPort(port)
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 20_000 })
    const context = browser.contexts()[0]
    if (!context) throw new Error('Electron CDP browser has no context')
    context.setDefaultTimeout(20_000)
    markStage('waiting for the initialized main renderer')
    // CDP may also expose background/guest pages. Never choose the first
    // target blindly or send preview IPC while the main renderer is booting.
    const isMainPage = (page: Page) => /\/main\.html(?:[?#]|$)/.test(page.url())
    await expect.poll(() => context.pages().some(isMainPage), { message: 'Production main.html target must be present', timeout: 20_000 }).toBe(true)
    const mainPage = context.pages().find(isMainPage)!
    await mainPage.waitForFunction(() => window.IsMainPage === true && typeof window.WebOpenWindow === 'function', undefined, { timeout: 30_000 })
    const videoPath = path.resolve('e2e/assets/mpv-sample.mp4')
    const audioPath = path.resolve('e2e/assets/mpv-sample.m4a')
    const parentPath = path.dirname(videoPath)
    const subtitlePath = path.resolve('e2e/assets/mpv-sample.srt')
    const subtitleUrl = pathToFileURL(subtitlePath).href
    markStage('opening the production player window')
    const existingPages = new Set(context.pages())
    const findPlayerPage = () => context.pages().find(page =>
      !existingPages.has(page) && /\/main2\.html(?:[?#]|$)/.test(page.url()))
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
    // Login webviews also emit CDP page events. Match the production preview
    // document, including pages that navigate from about:blank after creation.
    await expect.poll(() => Boolean(findPlayerPage()), { message: 'Production main2.html player window must open', timeout: 30_000 }).toBe(true)
    const player = findPlayerPage()!
    markStage('waiting for the MPV surface')
    // Loading the freshly bundled libmpv dependency graph can be slow on a
    // cold GitHub runner. Wait for the real production surface rather than
    // treating dependency loading latency as a playback failure.
    await player.waitForSelector('#mpvEmbeddedPlayer.mpv-embedded-surface', { timeout: 90_000 })
    await player.evaluate(({ externalAudioPath, externalSubtitlePath }) => {
      ;(window as any).__mpvControlLog = []
      const original = window.WebMpvEmbeddedControl
      window.WebMpvEmbeddedControl = async (request) => {
        const result = await original(request)
        ;(window as any).__mpvControlLog.push({ request, result })
        return result
      }
      window.WebShowOpenDialogSync = (options, callback) => callback([String(options?.title || '').includes('音频') ? externalAudioPath : externalSubtitlePath])
    }, { externalAudioPath: audioPath, externalSubtitlePath: subtitlePath })
    const surface = player.locator('#mpvEmbeddedPlayer')
    const surfaceBounds = await surface.boundingBox()
    if (!surfaceBounds) throw new Error('MPV surface has no visible bounds')
    // Reveal the auto-hiding transport through the same bottom pointer zone
    // used by real viewers, before Playwright waits for a stable play button.
    await player.mouse.move(surfaceBounds.x + surfaceBounds.width / 2, surfaceBounds.y + surfaceBounds.height - 40)

    markStage('play, pause and seek controls')
    const playButton = player.locator('.mpv-play-btn')
    await playButton.click()
    await expect.poll(() => player.evaluate(() => (window as any).__mpvControlLog.findLast((entry: any) => entry.request.action === 'pause')?.result?.ok), { message: '暂停按钮必须成功调用 MPV pause', timeout: 15_000 }).toBe(true)
    await expect.poll(async () => Boolean((await player.evaluate(() => window.WebMpvEmbeddedStatus())).status?.paused), { message: 'MPV 必须实际进入暂停状态', timeout: 15_000 }).toBe(true)
    await expect(playButton).toHaveAttribute('aria-label', '播放', { timeout: 15_000 })
    // Execute synchronously once the Vue state exposes the play action; the
    // three-second fixture can otherwise reach EOF during Playwright's actionability wait.
    await playButton.evaluate((button: HTMLButtonElement) => button.click())
    await expect.poll(() => player.evaluate(() => (window as any).__mpvControlLog.findLast((entry: any) => entry.request.action === 'play')?.result?.ok), { message: '播放按钮必须成功调用 MPV play', timeout: 15_000 }).toBe(true)
    await expect.poll(async () => Boolean((await player.evaluate(() => window.WebMpvEmbeddedStatus())).status?.paused), { message: 'MPV 必须实际恢复播放', timeout: 15_000 }).toBe(false)
    await setRange(player, player.getByRole('slider', { name: '播放进度' }), 1)
    await player.getByRole('button', { name: '音量', exact: true }).click()
    await setRange(player, player.getByRole('slider', { name: '音量' }), 35)
    await player.getByRole('button', { name: '音量', exact: true }).click()

    markStage('playlist controls')
    const optionsToggle = player.getByRole('button', { name: '播放选项', exact: true })
    await optionsToggle.click()
    await player.getByRole('button', { name: '播放列表与章节', exact: true }).click()
    const playlistTabs = player.locator('.mpv-playlist-tabs')
    await expect(playlistTabs.getByRole('button', { name: '章节' })).toBeVisible()
    await playlistTabs.getByRole('button', { name: '章节' }).click()
    await playlistTabs.getByRole('button', { name: '播放列表' }).click()

    markStage('video settings controls')
    await optionsToggle.click()
    await player.getByRole('button', { name: '播放设置', exact: true }).click()
    const originalFrame = await player.locator('.mpv-fallback-canvas').evaluate((canvas: HTMLCanvasElement) => ({ width: canvas.width, height: canvas.height }))
    await player.getByRole('combobox', { name: '画面比例', exact: true }).selectOption('1.7778')
    await player.getByRole('combobox', { name: '裁剪', exact: true }).selectOption('16:10')
    await player.getByRole('button', { name: '90°' }).click()
    if (process.platform !== 'darwin') {
      await expect.poll(async () => player.locator('.mpv-fallback-canvas').evaluate((canvas: HTMLCanvasElement) => ({ width: canvas.width, height: canvas.height })), {
        message: '软件帧应实际应用 16:10 中心裁剪和 90° 旋转'
      }).toMatchObject({ width: originalFrame.height, height: Math.round(originalFrame.height * 16 / 10) })
    }
    // The short fixture must not reach EOF while exercising settings and tracks.
    // Pause only after checking the transformed frames and retain all control checks.
    await player.evaluate(() => window.WebMpvEmbeddedControl({ action: 'pause' }))
    await player.getByRole('button', { name: '关闭设置', exact: true }).click()
    await optionsToggle.click()
    await player.getByRole('button', { name: '播放速度', exact: true }).click()
    const speedMenu = player.getByRole('menu', { name: '播放速度', exact: true })
    await expect(speedMenu.getByRole('menuitemradio')).toHaveCount(39)
    expect(await speedMenu.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true)
    await speedMenu.getByRole('menuitemradio', { name: '10×', exact: true }).click()
    await expect.poll(async () => (await player.evaluate(() => window.WebMpvEmbeddedStatus())).status?.speed).toBe(10)
    await optionsToggle.click()
    await player.getByRole('button', { name: '播放设置', exact: true }).click()
    await player.getByRole('combobox', { name: '倍速' }).selectOption('1.5')
    for (const label of ['硬件解码', '反交错', 'HDR 色调映射']) await player.getByText(label, { exact: true }).locator('..').getByRole('checkbox').click()
    const videoSection = player.locator('.mpv-side-settings-content').filter({ hasText: '均衡器' })
    await setRange(player, videoSection.locator('.mpv-video-filter-row input').first(), 10)

    markStage('audio settings controls')
    await player.getByRole('button', { name: '音频', exact: true }).click()
    await player.getByRole('button', { name: '加载外置音频…' }).click()
    await expect.poll(() => player.evaluate(() => (window as any).__mpvControlLog.filter((entry: any) => entry.request.action === 'addAudio').length), { message: '加载外置音频按钮必须调用 MPV addAudio', timeout: 10_000 }).toBeGreaterThan(0)
    const addAudioResult = await player.evaluate(() => (window as any).__mpvControlLog.findLast((entry: any) => entry.request.action === 'addAudio')?.result)
    expect(addAudioResult?.ok, JSON.stringify(addAudioResult, null, 2)).toBe(true)
    // The command reply precedes MPV's asynchronous track-list observation.
    await expect.poll(async () => (await player.evaluate(() => window.WebMpvEmbeddedStatus())).trackStatus?.tracks.filter((track: any) => track.type === 'audio').length || 0, { timeout: 10_000 }).toBeGreaterThan(1)
    const audioSelect = player.locator('select[title="音轨"]')
    await expect.poll(() => audioSelect.locator('option').count(), { timeout: 10_000 }).toBeGreaterThan(1)
    const audioValues = await audioSelect.locator('option').evaluateAll((items) => items.map((item) => (item as HTMLOptionElement).value))
    await audioSelect.selectOption(audioValues.find((value) => value !== '-1')!)
    const audioContent = player.locator('.mpv-side-settings-content')
    await setRange(player, audioContent.locator('.mpv-side-slider input').first(), 0.2)
    await setRange(player, audioContent.locator('.mpv-equalizer-band input').first(), 2)

    markStage('subtitle settings controls')
    await player.getByRole('button', { name: '关闭设置', exact: true }).click()
    await optionsToggle.click()
    await player.locator('.mpv-options-menu').getByRole('button', { name: '字幕', exact: true }).click()
    const settingsTabs = player.locator('.mpv-settings-tabs')
    await expect(settingsTabs.getByRole('button', { name: '字幕', exact: true })).toHaveClass(/active/)
    await settingsTabs.getByRole('button', { name: '弹幕', exact: true }).click()
    await expect(settingsTabs.getByRole('button', { name: '弹幕', exact: true })).toHaveClass(/active/)
    await settingsTabs.getByRole('button', { name: '字幕', exact: true }).click()
    await expect(settingsTabs.getByRole('button', { name: '视频', exact: true })).toBeVisible()
    await player.getByRole('button', { name: '加载字幕…' }).click()
    const subtitleSelect = player.locator('select[title="字幕"]')
    await expect.poll(() => subtitleSelect.locator('option').count()).toBeGreaterThan(1)
    const subtitleValues = await subtitleSelect.locator('option').evaluateAll((items) => items.map((item) => (item as HTMLOptionElement).value))
    const enabledSubtitle = subtitleValues.find((value) => value !== 'track:-1')!
    await subtitleSelect.selectOption(enabledSubtitle)
    await player.locator('select[title="副字幕"]').selectOption(enabledSubtitle)
    const subtitleContent = player.locator('.mpv-side-settings-content')
    const subtitleDelay = subtitleContent.getByRole('spinbutton', { name: '延迟显示[主]', exact: true })
    await subtitleDelay.fill('0.2')
    await subtitleDelay.dispatchEvent('change')
    await expect(subtitleDelay).toHaveValue('0.2')
    for (const label of ['垂直偏移', '大小缩放[主]']) {
      const row = subtitleContent.locator('.subtitle-number-row').filter({ has: player.getByText(label, { exact: true }) })
      const before = await row.locator('.subtitle-number-value').innerText()
      await row.getByRole('button', { name: `增加${label}`, exact: true }).click()
      await expect(row.locator('.subtitle-number-value')).not.toHaveText(before)
    }
    await subtitleContent.getByRole('button', { name: '减少不透明度', exact: true }).click()
    await subtitleContent.getByLabel('使用自定义样式', { exact: true }).check()
    const subtitleFont = subtitleContent.getByRole('combobox', { name: '字体', exact: true })
    await subtitleFont.selectOption('serif')
    await expect(subtitleFont).toHaveValue('serif')
    await subtitleContent.getByLabel('加粗', { exact: true }).check()
    await subtitleContent.getByLabel('斜体', { exact: true }).check()
    await subtitleContent.getByRole('button', { name: '增加描边大小', exact: true }).click()
    await subtitleContent.getByRole('button', { name: '增加阴影大小', exact: true }).click()
    for (const [label, value] of [['字体颜色', '#ffff00'], ['描边颜色', '#111111'], ['背景颜色', '#222222']] as const) {
      await subtitleContent.getByLabel(label).evaluate((element, nextValue) => {
        const input = element as HTMLInputElement
        input.value = nextValue
        input.dispatchEvent(new Event('input', { bubbles: true }))
        input.dispatchEvent(new Event('change', { bubbles: true }))
      }, value)
    }
    // Custom text styling now renders in Vue; placement/timing still go to
    // MPV. Verify both effects rather than requiring the removed command path.
    const primarySubtitleOverlay = player.locator('.mpv-live-subtitle').first()
    await expect(primarySubtitleOverlay).toHaveCSS('font-family', 'serif')
    await expect(primarySubtitleOverlay).toHaveCSS('font-weight', '700')
    await expect(primarySubtitleOverlay).toHaveCSS('font-style', 'italic')
    await expect(primarySubtitleOverlay).toHaveCSS('color', 'rgb(255, 255, 0)')
    await expect(primarySubtitleOverlay).toHaveCSS('background-color', 'rgb(34, 34, 34)')
    await expect(primarySubtitleOverlay).toHaveCSS('opacity', '0.95')
    for (const [property, propertyValue] of [['sub-delay', 0.2], ['sub-pos', 95], ['sub-scale', 1.05], ['sub-visibility', 'no']] as const) {
      await expect.poll(() => player.evaluate(({ property, propertyValue }) =>
        (window as any).__mpvControlLog.some((entry: any) => entry.request.action === 'setVideoProperty'
          && entry.request.property === property && entry.request.propertyValue === propertyValue && entry.result?.ok),
      { property, propertyValue }), { message: `MPV must accept ${property}=${propertyValue}`, timeout: 10_000 }).toBe(true)
    }
    await subtitleContent.getByRole('button', { name: '在线查找' }).click()
    await expect(player.getByText('在线字幕搜索')).toBeVisible()
    await player.locator('.mpv-subtitle-modal-close').click()

    markStage('intro and outro dialog controls')
    await player.getByRole('button', { name: '关闭设置', exact: true }).click()
    await optionsToggle.click()
    await player.getByRole('button', { name: '跳过片头片尾', exact: true }).click()
    const skipDialog = player.getByRole('dialog', { name: '播放', exact: true })
    const autoSkip = skipDialog.getByRole('switch', { name: '自动跳过片头片尾', exact: true })
    const introSwitch = skipDialog.getByRole('switch', { name: '自定义跳过片头', exact: true })
    const outroSwitch = skipDialog.getByRole('switch', { name: '自定义跳过片尾', exact: true })
    await autoSkip.click()
    await expect(introSwitch).toHaveAttribute('aria-checked', 'true')
    await expect(outroSwitch).toHaveAttribute('aria-checked', 'true')
    await skipDialog.getByRole('button', { name: '自定义跳过片头增加一秒', exact: true }).click()
    await expect(skipDialog.getByRole('group', { name: '自定义跳过片头时长', exact: true }).locator('output')).toHaveText('00:01')
    await skipDialog.getByRole('button', { name: '使用当前位置', exact: true }).nth(1).click()
    await expect(outroSwitch).toHaveAttribute('aria-checked', 'true')
    await autoSkip.click()
    await expect(introSwitch).toHaveAttribute('aria-checked', 'false')
    await expect(outroSwitch).toHaveAttribute('aria-checked', 'false')
    await expect(skipDialog.getByRole('group', { name: '自定义跳过片头时长', exact: true }).locator('output')).toHaveText('00:01')
    await skipDialog.getByRole('button', { name: '关闭', exact: true }).click()
    await expect(skipDialog).toHaveCount(0)

    const log = await player.evaluate(() => (window as any).__mpvControlLog)
    const actions = log.map((entry: any) => entry.request.action)
    for (const action of ['pause', 'play', 'seek', 'setVolume', 'setSpeed', 'addAudio', 'setAudioTrack', 'addSubtitle', 'setSubtitleTrack', 'setVideoProperty']) expect(actions).toContain(action)
    const failures = log.filter((entry: any) => !entry.result?.ok)
    expect(failures, JSON.stringify(failures, null, 2)).toEqual([])
    await expect(surface.locator('.mpv-embedded-error')).toHaveCount(0)
  } catch (error) {
    console.error(`MPV controls failed during: ${stage}\nEmbedded MPV Electron output (tail):\n${electronOutput}`)
    throw error
  } finally {
    await testInfo.attach('mpv-controls-stage', { body: stage, contentType: 'text/plain' })
    await testInfo.attach('mpv-controls-electron-log', { body: electronOutput, contentType: 'text/plain' })
    writeFileSync(testInfo.outputPath('mpv-controls-stage.txt'), stage)
    writeFileSync(testInfo.outputPath('mpv-controls-electron.log'), electronOutput)
    if (electronProcess.pid) {
      if (process.platform === 'win32') {
        try { execFileSync('taskkill', ['/PID', String(electronProcess.pid), '/T', '/F'], { stdio: 'ignore' }) } catch {}
      } else electronProcess.kill('SIGKILL')
    }
    await browser?.close().catch(() => undefined)
  }
})
