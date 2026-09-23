import { expect, test } from './fixtures/boxPlayer'
import type { Page } from '@playwright/test'
// @ts-expect-error CommonJS helper is also executed directly by Actions.
import { loadRealMediaServerE2EConfig } from '../scripts/real-media-server-e2e-config.cjs'

const enabled = Boolean(process.env.BOXPLAYER_E2E_EMBY_JSON?.trim())
const config = enabled ? loadRealMediaServerE2EConfig() : undefined

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

if (!enabled) {
  test('real Emby playback requires an encrypted CI server secret', async () => {
    test.skip(true, 'Set BOXPLAYER_E2E_EMBY_JSON to run the real Emby release gate')
  })
} else {
  test('Emby authenticates, searches, resolves playback metadata and plays through MPV', async ({ boxPlayer }) => {
    const { app, page, pageErrors, consoleErrors } = boxPlayer
    const embyPaths = new Set<string>()
    const base = new URL(config!.baseUrl)
    const capture = (request: import('@playwright/test').Request) => {
      const url = new URL(request.url())
      if (url.origin === base.origin) embyPaths.add(url.pathname)
    }
    app.context().on('request', capture)

    let player: Page | undefined
    try {
      await page.locator('#xbyhead2 .arco-menu-item').getByText('媒体服务器', { exact: true }).click()
      const serverRow = page.locator('.media-server-sidebar .server-item').filter({ hasText: config!.name })
      await expect(serverRow).toBeVisible({ timeout: 30_000 })
      await serverRow.click()
      await expect(page.locator('.workspace-tabs')).toBeVisible({ timeout: 60_000 })
      await page.locator('.workspace-tab').getByText('搜索', { exact: true }).click()
      const search = page.locator('.search-input-hero input')
      await expect(search).toBeVisible()
      await search.fill(config!.mediaTitle)
      await search.press('Enter')

      const result = page.locator('.poster-tile').filter({ has: page.getByText(config!.mediaTitle, { exact: true }) }).first()
      await expect(result, `Emby search did not return ${config!.mediaTitle}`).toBeVisible({ timeout: 90_000 })
      await result.click()
      const play = page.locator('.detail-primary-play')
      await expect(play).toBeVisible({ timeout: 90_000 })
      const playerPromise = app.waitForEvent('window', { timeout: 60_000 })
      await play.click()
      player = await playerPromise
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
