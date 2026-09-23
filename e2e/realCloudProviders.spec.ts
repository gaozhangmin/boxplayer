import { expect, test, type Page } from './fixtures/boxPlayer'
// @ts-expect-error CommonJS helper is also executed directly by Actions.
import { loadRealCloudE2EConfig } from '../scripts/real-cloud-e2e-config.cjs'

const providerLabels: Record<string, string> = {
  aliyun: '阿里云盘', cloud123: '123网盘', '115': '115网盘', baidu: '百度网盘', pikpak: 'PikPak',
  quark: '夸克网盘', '139': '139云盘', '189': '天翼云盘', guangya: '光鸭云盘', dropbox: 'Dropbox',
  onedrive: 'OneDrive', box: 'Box', google: 'Google Drive'
}

const enabled = Boolean(process.env.BOXPLAYER_E2E_ACCOUNTS_JSON?.trim())
const config = enabled ? loadRealCloudE2EConfig() : undefined

test.setTimeout(45 * 60_000)

function fileListItem(page: Page, name: string) {
  return page.locator('#panfilelist:visible .fileitem, #panfilelist:visible .griditem').filter({ has: page.getByText(name, { exact: true }) }).first()
}

async function switchToProvider(page: Page, provider: string): Promise<void> {
  const label = providerLabels[provider]
  if (!label) throw new Error(`No UI label is configured for ${provider}`)
  const accountTrigger = page.locator('.user-avatar-trigger')
  await expect(accountTrigger).toBeVisible({ timeout: 60_000 })
  await accountTrigger.hover()
  const accountRow = page.locator('.user-list-row').filter({ has: page.locator(`.user-provider[title="${label}"]`) }).first()
  await expect(accountRow, `${label} CI 测试账号没有出现在账号列表`).toBeVisible({ timeout: 15_000 })
  const accountSwitch = accountRow.locator('.arco-switch')
  if (!(await accountSwitch.getAttribute('class'))?.includes('arco-switch-checked')) await accountSwitch.click()
  await expect(accountTrigger).toHaveAttribute('title', label, { timeout: 60_000 })
  await page.keyboard.press('Escape')
}

async function openCloudRoot(page: Page): Promise<void> {
  const cloudNav = page.locator('#xbyhead2 .arco-menu-item').getByText('网盘', { exact: true })
  if (await cloudNav.isVisible()) await cloudNav.click()
  const breadcrumbs = page.locator('#xbybody > .arco-tabs > .arco-tabs-content > .arco-tabs-content-list > .arco-tabs-content-item-active .toppannavitem:visible')
  const rootNode = page.locator('.dirtree:visible .dirtitle').getByText('根目录', { exact: true })
  if (await rootNode.isVisible()) await rootNode.click()
  await expect.poll(async () => {
    const title = await breadcrumbs.last().getAttribute('title').catch(() => '')
    return title === '根目录'
  }, { timeout: 60_000 }).toBe(true)
  await expect.poll(() => page.locator('#panfilelist:visible .fileitem, #panfilelist:visible .griditem').count(), { timeout: 60_000 }).toBeGreaterThan(0)
}

async function openFolder(page: Page, name: string): Promise<void> {
  const row = fileListItem(page, name)
  await expect(row, `找不到测试目录 ${name}`).toBeVisible({ timeout: 60_000 })
  await row.getByText(name, { exact: true }).click()
  await expect.poll(() => page.locator('.toppannavitem:visible').last().getAttribute('title'), { timeout: 60_000 }).toBe(name)
}

async function assertRealMpvPlayback(player: Page, provider: string): Promise<void> {
  await player.waitForLoadState('domcontentloaded')
  const surface = player.locator('#mpvEmbeddedPlayer.mpv-embedded-surface')
  await expect(surface, `${provider} 没有打开内置 MPV`).toBeVisible({ timeout: 90_000 })
  await expect.poll(async () => {
    const result = await player.evaluate(() => window.WebMpvEmbeddedStatus())
    return Boolean(result?.ok && Number(result.status?.duration) > 0 && Number(result.status?.position) > 0)
  }, { timeout: 90_000, intervals: [500, 1_000, 2_000] }).toBe(true)

  const pause = await player.evaluate(() => window.WebMpvEmbeddedControl({ action: 'pause' }))
  expect(pause.ok, `${provider} MPV pause: ${pause.error || 'unknown error'}`).toBe(true)
  const pausedPosition = Number(pause.status?.position || 0)
  const duration = Number(pause.status?.duration || 0)
  const seekTarget = Math.max(0.5, Math.min(duration > 2 ? duration - 1 : duration / 2, pausedPosition + 2))
  const seek = await player.evaluate(value => window.WebMpvEmbeddedControl({ action: 'seek', value }), seekTarget)
  expect(seek.ok, `${provider} MPV seek: ${seek.error || 'unknown error'}`).toBe(true)
  const play = await player.evaluate(() => window.WebMpvEmbeddedControl({ action: 'play' }))
  expect(play.ok, `${provider} MPV play: ${play.error || 'unknown error'}`).toBe(true)
  await expect.poll(async () => {
    const result = await player.evaluate(() => window.WebMpvEmbeddedStatus())
    return Number(result.status?.position || 0)
  }, { timeout: 30_000 }).toBeGreaterThan(Math.max(0, seekTarget - 1.5))
  await expect(surface.locator('.mpv-embedded-error')).toHaveCount(0)
}

if (!enabled) {
  test('real cloud provider matrix requires encrypted CI account secrets', async () => {
    test.skip(true, 'Set BOXPLAYER_E2E_ACCOUNTS_JSON to run the real-provider release gate')
  })
} else {
  test('all configured cloud providers refresh, list files, resolve authenticated URLs and play through MPV', async ({ boxPlayer }) => {
    const { app, page, pageErrors, consoleErrors } = boxPlayer
    const failures: string[] = []
    for (const target of config!.targets) {
      pageErrors.splice(0)
      consoleErrors.splice(0)
      let player: Page | undefined
      try {
        await switchToProvider(page, target.provider)
        await openCloudRoot(page)
        for (const folder of target.path) await openFolder(page, folder)
        const video = fileListItem(page, target.fileName)
        await expect(video, `${target.provider} 找不到测试视频 ${target.fileName}`).toBeVisible({ timeout: 60_000 })
        const playerPromise = app.waitForEvent('window', { timeout: 60_000 })
        await video.getByText(target.fileName, { exact: true }).click()
        player = await playerPromise
        await assertRealMpvPlayback(player, target.provider)
        expect(pageErrors, `${target.provider} renderer errors`).toEqual([])
        expect(consoleErrors, `${target.provider} console errors`).toEqual([])
      } catch (error) {
        failures.push(`${target.provider}: ${error instanceof Error ? error.message : String(error)}`)
      } finally {
        if (player && !player.isClosed()) await player.close().catch(() => undefined)
      }
    }
    expect(failures, failures.join('\n\n')).toEqual([])
  })
}
