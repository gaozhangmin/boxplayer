import { expect, test } from './fixtures/boxPlayer'
import type { ElectronApplication, Page } from '@playwright/test'

const enabled = Boolean(process.env.BOXPLAYER_E2E_EMBY_JSON?.trim())

test.setTimeout(15 * 60_000)

async function assertRealMpvPlayback(player: Page): Promise<void> {
  await player.waitForLoadState('domcontentloaded')
  const surface = player.locator('#mpvEmbeddedPlayer.mpv-embedded-surface')
  await expect(surface, 'Emby did not open the embedded MPV player').toBeVisible({ timeout: 90_000 })
  await expect.poll(async () => {
    const result = await player.evaluate(() => window.WebMpvEmbeddedStatus())
    return Boolean(result?.ok && Number(result.status?.duration) > 0 && Number(result.status?.position) > 0)
  }, { timeout: 120_000, intervals: [500, 1_000, 2_000] }).toBe(true)

  const pause = await player.evaluate(() => window.WebMpvEmbeddedControl({ action: 'pause' }))
  expect(pause.ok, pause.error || 'Emby MPV pause failed').toBe(true)
  const duration = Number(pause.status?.duration || 0)
  const current = Number(pause.status?.position || 0)
  const target = Math.max(0.5, Math.min(duration > 2 ? duration - 1 : duration / 2, current + 2))
  expect((await player.evaluate(value => window.WebMpvEmbeddedControl({ action: 'seek', value }), target)).ok).toBe(true)
  expect((await player.evaluate(() => window.WebMpvEmbeddedControl({ action: 'play' }))).ok).toBe(true)
  await expect.poll(async () => Number((await player.evaluate(() => window.WebMpvEmbeddedStatus())).status?.position || 0), { timeout: 30_000 }).toBeGreaterThan(Math.max(0, target - 1.5))
  await expect(surface.locator('.mpv-embedded-error')).toHaveCount(0)
}

async function openMpvPlayerWindow(app: ElectronApplication, action: () => Promise<void>): Promise<Page> {
  const existing = new Set(app.windows())
  await action()
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    for (const candidate of app.windows()) {
      if (existing.has(candidate) || candidate.isClosed()) continue
      if (await candidate.locator('#mpvEmbeddedPlayer').count().catch(() => 0)) return candidate
    }
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  throw new Error('Emby 没有创建 PageVideo MPV 窗口')
}

if (!enabled) {
  test('real Emby playback requires an encrypted CI server secret', async () => {
    test.skip(true, 'Set BOXPLAYER_E2E_EMBY_JSON to run the real Emby release gate')
  })
} else {
  test('Emby authenticates, searches, resolves playback metadata and plays through MPV', async ({ boxPlayer }) => {
    const { app, page, pageErrors, consoleErrors, mediaServer } = boxPlayer
    expect(mediaServer, 'Emby CI login did not produce a media-server fixture').toBeTruthy()
    const embyPaths = new Set<string>()
    const base = new URL(mediaServer!.baseUrl)
    const capture = (request: import('@playwright/test').Request) => {
      const url = new URL(request.url())
      if (url.origin === base.origin) embyPaths.add(url.pathname)
    }
    app.context().on('request', capture)

    let player: Page | undefined
    try {
      const mediaServerTab = page.locator('[data-testid="top-nav-media-server"]')
      await expect(mediaServerTab).toBeVisible({ timeout: 30_000 })
      await mediaServerTab.click()
      await expect(mediaServerTab).toHaveClass(/arco-menu-selected/, { timeout: 30_000 })
      const serverRow = page.locator('.media-server-sidebar .server-item').filter({ hasText: mediaServer!.name })
      await expect(serverRow).toBeVisible({ timeout: 30_000 })
      await serverRow.click()
      const workspaceTabs = page.locator('.workspace-tabs')
      await expect(workspaceTabs).toBeVisible({ timeout: 60_000 })
      // Search is the second workspace tab in every locale. Do not couple the
      // release gate to the runner's translated label (搜索/Search/etc.).
      const searchTab = workspaceTabs.locator('.workspace-tab').nth(1)
      await expect(searchTab).toBeVisible({ timeout: 30_000 })
      await searchTab.click()
      const search = page.locator('.search-input-hero input')
      await expect(search).toBeVisible()
      await search.fill(mediaServer!.mediaTitle)
      await search.press('Enter')

      // Episode results can be labeled with their parent series title in the
      // poster row, even though the search query matched the episode filename.
      // Scope to the Episodes row and click its result rather than requiring
      // the raw filename to be rendered as the card's visible title.
      const episodeRow = page.locator('.search-result-stack .home-section').filter({ has: page.locator('.home-section-header').getByText(/Episodes|剧集/) }).first()
      const result = episodeRow.locator('.poster-tile').first()
      await expect(result, `Emby search did not return an episode for ${mediaServer!.mediaTitle}`).toBeVisible({ timeout: 90_000 })
      await result.click()
      const play = page.locator('.detail-primary-play')
      await expect(play).toBeVisible({ timeout: 90_000 })
      player = await openMpvPlayerWindow(app, () => play.click())
      await assertRealMpvPlayback(player)

      expect([...embyPaths].some(path => /\/Users\/[^/]+\/Items/i.test(path)), `Emby item API was not called: ${[...embyPaths].join(', ')}`).toBe(true)
      expect([...embyPaths].some(path => /\/Items\/[^/]+\/PlaybackInfo/i.test(path)), `Emby PlaybackInfo API was not called: ${[...embyPaths].join(', ')}`).toBe(true)
      expect(pageErrors).toEqual([])
      expect(consoleErrors).toEqual([])
    } finally {
      app.context().off('request', capture)
      if (player && !player.isClosed()) await player.close().catch(() => undefined)
    }
  })
}
